function setupExportImport() {
    const exportButton = document.getElementById('export-btn');
    const importButton = document.getElementById('import-btn');
    const importFile = document.getElementById('importFile');
    importFile.accept = '.json,application/json';

    exportButton.addEventListener('click', exportData);
    importButton.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importData);
}

function validateBackupIntegrity(cards, wrappers, mediaRecords) {
    if (!Array.isArray(cards) || !Array.isArray(wrappers) || !Array.isArray(mediaRecords)) {
        throw new Error('Backup data must contain cards, wrappers and media arrays');
    }

    const collectUniqueIds = (items, label) => {
        const ids = new Set();
        items.forEach(item => {
            const id = String(item?.id ?? '').trim();
            if (!id) throw new Error(`Every ${label} needs a valid id`);
            if (ids.has(id)) throw new Error(`Duplicate ${label} id: ${id}`);
            ids.add(id);
        });
        return ids;
    };

    const wrapperIds = collectUniqueIds(wrappers, 'wrapper');
    collectUniqueIds(cards, 'card');
    const mediaIds = collectUniqueIds(mediaRecords, 'media asset');

    cards.forEach(card => {
        const cardId = String(card.id);
        const wrapperId = String(card.wrapperId ?? '').trim();
        if (!wrapperIds.has(wrapperId)) {
            throw new Error(`Card ${cardId} references a missing wrapper: ${wrapperId || '(empty)'}`);
        }

        if (card.imageKind !== 'local') return;
        const localMediaId = mediaStorage.localId(cardId);
        if (!mediaIds.has(localMediaId)) {
            throw new Error(`Backup is missing the local image for card ${cardId}`);
        }

        const localRecord = mediaRecords.find(record => String(record.id) === localMediaId);
        if (!(localRecord?.blob instanceof Blob) || localRecord.blob.size === 0) {
            throw new Error(`Backup contains an invalid local image for card ${cardId}`);
        }
        if (card.imageRevision && localRecord.revision !== card.imageRevision) {
            throw new Error(`Backup contains the wrong local image revision for card ${cardId}`);
        }
    });
}

async function buildExportPayload(snapshot = null) {
    const source = snapshot || await readCurrentExportSnapshot();
    const { cards, wrappers, wrapperStates, highestDefaultNum, allMedia, language } = source;
    const usedMediaIds = new Set(cards.map(card => mediaStorage.getIdForCard(card)).filter(Boolean));
    const media = allMedia.filter(record => usedMediaIds.has(record.id));
    validateBackupIntegrity(cards, wrappers, media);

    return {
        version: CONFIG.SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        cards,
        wrappers,
        wrapperStates,
        highestDefaultNum,
        settings: { language },
        assets: await mediaStorage.recordsToPortable(media)
    };
}

async function readCurrentExportSnapshot() {
    const [cards, wrappers, wrapperStates, highestDefaultNum, allMedia] = await Promise.all([
        dataManager.getAllCards(),
        dataManager.getAllWrappers(),
        dataManager.getWrapperStates(),
        storage.get(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM),
        mediaStorage.getAll()
    ]);
    return {
        cards,
        wrappers,
        wrapperStates,
        highestDefaultNum,
        allMedia,
        language: window.i18n.currentLanguage
    };
}

async function readLegacyExportSnapshot(localItems, syncItems) {
    await mediaStorage.initialize();
    const migration = await mediaStorage.migrateLegacyPreviews(
        localItems[CONFIG.STORAGE_KEYS.CARDS] || []
    );
    return {
        cards: migration.cards,
        wrappers: syncItems[CONFIG.STORAGE_KEYS.WRAPPERS] || [],
        wrapperStates: syncItems[CONFIG.STORAGE_KEYS.WRAPPER_STATES] || {},
        highestDefaultNum: localItems[CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM] ?? -1,
        allMedia: migration.records,
        language: resolveExportLanguage(syncItems.language)
    };
}

function resolveExportLanguage(savedLanguage) {
    if (savedLanguage) return savedLanguage;
    const browserLanguage = navigator.language.split('-')[0];
    return ['en', 'es', 'fr', 'de'].includes(browserLanguage) ? browserLanguage : 'en';
}

async function exportData() {
    try {
        await downloadExportBackup();
    } catch (error) {
        console.error('Unable to export Portal Atlas:', error);
        alert(window.i18n.translate('export_error'));
    }
}

async function downloadExportBackup(snapshot = null) {
    const payload = await buildExportPayload(snapshot);
    const serialized = await serializeBackup(payload);
    const timestamp = createExportTimestamp(new Date());
    return downloadBlob(serialized.blob, `PortalAtlas_Backup_${timestamp}.${serialized.extension}`);
}

function createExportTimestamp(now) {
    return now.getFullYear()
        + String(now.getMonth() + 1).padStart(2, '0')
        + String(now.getDate()).padStart(2, '0')
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0')
        + String(now.getSeconds()).padStart(2, '0');
}

async function serializeBackup(payload) {
    return {
        blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
        extension: 'json'
    };
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
        chrome.downloads.download({ url, filename, saveAs: false }, downloadId => {
            const error = chrome.runtime.lastError;
            URL.revokeObjectURL(url);
            if (error) {
                reject(new Error(error.message));
                return;
            }
            if (!Number.isInteger(downloadId)) {
                reject(new Error('Chrome did not confirm the backup download'));
                return;
            }
            resolve(downloadId);
        });
    });
}

async function ensureV2MigrationBackup({ beforeMigrationOnly = false } = {}) {
    const run = async () => {
        const localItems = await getChromeStorage('local');
        if (localItems[CONFIG.STORAGE_KEYS.V2_MIGRATION_BACKUP]?.version === CONFIG.SCHEMA_VERSION) {
            return false;
        }

        const syncItems = await getChromeStorage('sync');
        const hasLegacyData = (Array.isArray(localItems[CONFIG.STORAGE_KEYS.CARDS])
            && localItems[CONFIG.STORAGE_KEYS.CARDS].length > 0
            || Array.isArray(syncItems[CONFIG.STORAGE_KEYS.WRAPPERS])
            && syncItems[CONFIG.STORAGE_KEYS.WRAPPERS].length > 0);
        const hasV2Data = localItems[CONFIG.STORAGE_KEYS.V2_SCHEMA] === CONFIG.SCHEMA_VERSION
            || syncItems[CONFIG.STORAGE_KEYS.V2_SCHEMA] === CONFIG.SCHEMA_VERSION;
        const needsPreMigrationBackup = hasLegacyData && !hasV2Data;

        if (beforeMigrationOnly && !needsPreMigrationBackup) return false;

        const snapshot = needsPreMigrationBackup
            ? await readLegacyExportSnapshot(localItems, syncItems)
            : null;
        const downloadId = await downloadExportBackup(snapshot);

        // Persist success only after chrome.downloads returned a valid id.
        await setChromeStorage('local', {
            [CONFIG.STORAGE_KEYS.V2_MIGRATION_BACKUP]: {
                version: CONFIG.SCHEMA_VERSION,
                downloadId,
                downloadStartedAt: new Date().toISOString()
            }
        });
        return true;
    };

    // Multiple new tabs can start together. The lock is only coordination;
    // correctness and retry behavior depend on the persistent local marker.
    if (navigator.locks?.request) {
        return navigator.locks.request('portal-atlas-v2-migration-backup', run);
    }
    return run();
}

function getChromeStorage(areaName) {
    return new Promise((resolve, reject) => {
        chrome.storage[areaName].get(null, result => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(result);
        });
    });
}

function setChromeStorage(areaName, values) {
    return new Promise((resolve, reject) => {
        chrome.storage[areaName].set(values, () => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve();
        });
    });
}

async function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const parsed = await parseBackupFile(file);
        const prepared = await prepareImportedBackup(parsed);
        await commitImportedBackup(prepared);
        await renderWrappers();

        const language = prepared.settings?.language;
        if (language && window.i18n.isLanguageSupported(language)) {
            await window.i18n.setLanguage(language);
        }
        alert(window.i18n.translate('import_success'));
    } catch (error) {
        console.error('Unable to import Portal Atlas backup:', error);
        alert(window.i18n.translate('import_error'));
    } finally {
        event.target.value = '';
    }
}

async function parseBackupFile(file) {
    return JSON.parse(await file.text());
}

async function prepareImportedBackup(parsed) {
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid backup');

    if (Number(parsed.version) === CONFIG.SCHEMA_VERSION && Array.isArray(parsed.assets)) {
        if (!Array.isArray(parsed.cards) || !Array.isArray(parsed.wrappers)) {
            throw new Error('Incomplete Portal Atlas backup');
        }
        const mediaRecords = mediaStorage.portableToRecords(parsed.assets || []);
        validateBackupIntegrity(parsed.cards, parsed.wrappers, mediaRecords);
        return {
            cards: parsed.cards,
            wrappers: parsed.wrappers,
            wrapperStates: parsed.wrapperStates || {},
            highestDefaultNum: parsed.highestDefaultNum ?? -1,
            settings: parsed.settings || {},
            mediaRecords
        };
    }

    // V1 backups were plain { cards, wrappers } JSON files with Base64
    // previews embedded in each card.
    if (Array.isArray(parsed.cards) && Array.isArray(parsed.wrappers)) {
        const migration = await mediaStorage.migrateLegacyPreviews(parsed.cards);
        validateBackupIntegrity(migration.cards, parsed.wrappers, migration.records);
        return {
            cards: migration.cards,
            wrappers: parsed.wrappers,
            wrapperStates: parsed.wrapperStates || {},
            highestDefaultNum: parsed.highestDefaultNum ?? -1,
            settings: parsed.settings || {},
            mediaRecords: migration.records
        };
    }

    throw new Error('Unknown Portal Atlas backup format');
}

async function commitImportedBackup(prepared) {
    const previous = {
        cards: await dataManager.getAllCards(),
        wrappers: await dataManager.getAllWrappers(),
        wrapperStates: await dataManager.getWrapperStates(),
        highestDefaultNum: await storage.get(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM),
        mediaRecords: await mediaStorage.getAll()
    };

    try {
        // Images are committed first. If this transaction fails, metadata is
        // untouched. Metadata keeps a complete local mirror if Sync rejects.
        await mediaStorage.replaceAll(prepared.mediaRecords);
        await storage.replaceAllData(prepared);
    } catch (error) {
        try {
            await mediaStorage.replaceAll(previous.mediaRecords);
            await storage.replaceAllData(previous);
        } catch (rollbackError) {
            console.error('Portal Atlas rollback also failed:', rollbackError);
        }
        throw error;
    }
}
