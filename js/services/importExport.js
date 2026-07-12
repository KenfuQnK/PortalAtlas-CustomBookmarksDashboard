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
    const media = await Promise.all(allMedia
        .filter(record => usedMediaIds.has(record.id))
        .map(async record => {
            const previewRevision = await mediaStorage.fingerprintBlob(record.blob);
            return {
                ...record,
                qualityBlob: null,
                qualityWidth: 0,
                qualityHeight: 0,
                revision: record.sourceType === 'local' ? previewRevision : '',
                contentRevision: previewRevision
            };
        }));
    const mediaById = new Map(media.map(record => [record.id, record]));
    const backupCards = cards.map(card => {
        if (card.imageKind !== 'local') return card;
        const record = mediaById.get(mediaStorage.localId(card.id));
        return record ? { ...card, imageRevision: record.revision } : card;
    });
    validateBackupIntegrity(backupCards, wrappers, media);

    return {
        version: CONFIG.SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        cards: backupCards,
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
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    try {
        anchor.click();
    } finally {
        anchor.remove();
        // Keep the object URL alive long enough for Chrome to begin reading it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return filename;
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
        const mediaById = new Map(mediaRecords.map(record => [String(record.id), record]));
        const cards = await Promise.all(parsed.cards.map(async card => {
            if (card.imageKind !== 'local') return card;
            const record = mediaById.get(mediaStorage.localId(card.id));
            if (!record?.blob) return card;
            const revision = await mediaStorage.fingerprintBlob(record.blob);
            record.revision = revision;
            record.contentRevision = revision;
            return { ...card, imageRevision: revision };
        }));
        validateBackupIntegrity(cards, parsed.wrappers, mediaRecords);
        return {
            cards,
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
        if (typeof driveSync !== 'undefined') driveSync.notifyLocalAssetChanged();
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
