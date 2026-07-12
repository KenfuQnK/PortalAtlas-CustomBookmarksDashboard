const driveSync = {
    _state: {
        enabled: false,
        status: 'disconnected',
        lastSyncAt: '',
        lastError: '',
        needsSync: false,
        progressDone: 0,
        progressTotal: 0
    },
    _token: '',
    _filesPromise: null,
    _syncPromise: null,
    _retryTimer: null,
    _listenersReady: false,

    async initialize() {
        const [stored, syncedPreference] = await Promise.all([
            this._getLocalState(),
            this._getSyncedPreference()
        ]);
        this._state = { ...this._state, ...stored };
        if (syncedPreference.exists) this._state.enabled = syncedPreference.enabled;
        this._state.status = this._state.enabled ? 'idle' : 'disconnected';
        this._setupRetryListeners();
        this._emitStatus();

        if (!this._state.enabled || !this.isConfigured()) return;
        if (!navigator.onLine) {
            this._setStatus('offline');
            return;
        }

        try {
            await this._getAuthToken(false);
            this._scheduleSync(500);
        } catch (error) {
            // A non-interactive token can be unavailable after Chrome account
            // changes. Keep Drive enabled so the UI can offer reconnection.
            this._setStatus('authorization_required', error.message);
        }
    },

    isConfigured() {
        const clientId = chrome.runtime.getManifest().oauth2?.client_id || '';
        return Boolean(clientId)
            && !clientId.includes('REPLACE_WITH')
            && clientId.endsWith('.apps.googleusercontent.com');
    },

    getState() {
        return {
            ...this._state,
            configured: this.isConfigured(),
            online: navigator.onLine
        };
    },

    async connect() {
        if (!this.isConfigured()) {
            const error = new Error('Google Drive OAuth is not configured for this extension build');
            error.code = 'DRIVE_NOT_CONFIGURED';
            throw error;
        }
        if (!navigator.onLine) throw new Error('Internet connection required to connect Google Drive');

        this._setStatus('connecting');
        try {
            await this._getAuthToken(true);
        } catch (error) {
            this._state.enabled = false;
            await this._persistState();
            this._setStatus('error', error.message);
            throw error;
        }

        this._state.enabled = true;
        this._state.needsSync = true;
        await Promise.all([this._persistState(), this._setSyncedPreference(true)]);
        try {
            return await this.syncAll({ interactive: false });
        } catch (error) {
            // Authorization succeeded. Keep the connection enabled and queue
            // the transfer so a temporary network/API failure can recover.
            throw error;
        }
    },

    async disconnect() {
        const token = this._token;
        this._token = '';
        this._filesPromise = null;
        clearTimeout(this._retryTimer);
        this._retryTimer = null;

        if (token) {
            await new Promise(resolve => {
                chrome.identity.removeCachedAuthToken({ token }, () => resolve());
            });
            try {
                await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });
            } catch (error) {
                console.warn('Unable to revoke the Google token remotely:', error);
            }
        }

        this._state = {
            ...this._state,
            enabled: false,
            status: 'disconnected',
            lastError: '',
            needsSync: false,
            progressDone: 0,
            progressTotal: 0
        };
        await Promise.all([this._persistState(), this._setSyncedPreference(false)]);
        this._emitStatus();
    },

    async deleteAllData() {
        if (!this._state.enabled) throw new Error('Google Drive is not connected');
        if (!this.isConfigured()) throw new Error('Google Drive OAuth is not configured');
        if (!navigator.onLine) throw new Error('Internet connection required to delete Google Drive data');

        this._setStatus('syncing');
        try {
            await this._getAuthToken(true);
            this._filesPromise = null;
            const files = (await this._listFiles())
                .filter(file => file.name?.startsWith(CONFIG.DRIVE.FILE_PREFIX));
            this._state.progressDone = 0;
            this._state.progressTotal = files.length;
            this._emitStatus();

            for (const file of files) {
                await this._deleteFile(file.id);
                this._state.progressDone += 1;
                this._emitStatus();
            }

            this._filesPromise = null;
            await this.disconnect();
            return { deleted: files.length };
        } catch (error) {
            this._filesPromise = null;
            this._state.needsSync = true;
            await this._persistState();
            this._setStatus(navigator.onLine ? 'error' : 'offline', error.message);
            throw error;
        }
    },

    notifyLocalAssetChanged() {
        this._state.needsSync = true;
        this._persistState().catch(error => console.warn('Unable to persist Drive queue state:', error));
        if (this._state.enabled) this._scheduleSync(1200);
    },

    notifyDataChanged() {
        this.notifyLocalAssetChanged();
    },

    async syncAll({ interactive = false } = {}) {
        if (this._syncPromise) return this._syncPromise;
        this._syncPromise = this._performSync(interactive).finally(() => {
            this._syncPromise = null;
        });
        return this._syncPromise;
    },

    async _performSync(interactive) {
        if (!this._state.enabled) throw new Error('Google Drive is not connected');
        if (!this.isConfigured()) throw new Error('Google Drive OAuth is not configured');
        if (!navigator.onLine) {
            this._setStatus('offline');
            throw new Error('No internet connection');
        }

        this._setStatus('syncing');
        try {
            await this._getAuthToken(interactive);
            this._filesPromise = null;
            const [cards, records, files] = await Promise.all([
                dataManager.getAllCards(),
                mediaStorage.getAll(),
                this._listFiles()
            ]);
            const recordsById = new Map(records.map(record => [record.id, record]));
            const filesByName = new Map(files.map(file => [file.name, file]));
            const descriptors = [];
            const seenNames = new Set();

            for (const card of cards) {
                const descriptor = await this._descriptorForCard(card);
                if (!descriptor || seenNames.has(descriptor.name)) continue;
                seenNames.add(descriptor.name);
                descriptors.push({ card, descriptor });
            }

            // Keep only one file for every live image descriptor. Everything
            // else is an orphan left by a deleted card/section or a duplicate
            // created by an interrupted upload.
            const staleFiles = files.filter(file => file.name?.startsWith(CONFIG.DRIVE.FILE_PREFIX)
                && (!seenNames.has(file.name) || filesByName.get(file.name)?.id !== file.id));

            this._state.progressDone = 0;
            this._state.progressTotal = descriptors.length + staleFiles.length;
            this._emitStatus();
            let changedLocalImages = false;

            for (const item of descriptors) {
                const mediaId = mediaStorage.getIdForCard(item.card);
                let record = recordsById.get(mediaId) || null;
                const file = filesByName.get(item.descriptor.name) || null;

                if (item.card.imageKind === 'local'
                    && record
                    && item.card.imageRevision
                    && record.revision !== item.card.imageRevision) {
                    record = null;
                }

                if (record && !file) {
                    record = await this._prepareRecordForDrive(item.card, record);
                    const uploaded = await this._uploadRecord(item.card, item.descriptor, record, null);
                    filesByName.set(uploaded.name, uploaded);
                } else if (!record && file) {
                    const restored = await this._downloadRecord(item.card, file);
                    recordsById.set(restored.id, restored);
                    changedLocalImages = true;
                } else if (record && file) {
                    const localRevision = record.contentRevision || await mediaStorage.fingerprintBlob(
                        record.qualityBlob || record.blob
                    );
                    const driveRevision = file.appProperties?.contentRevision || '';
                    if (record.qualityBlob) {
                        if (localRevision !== driveRevision) {
                            await this._uploadRecord(item.card, item.descriptor, record, file);
                        } else {
                            await mediaStorage.discardQuality(mediaId);
                        }
                    } else if (item.card.imageKind === 'url' && localRevision !== driveRevision) {
                        const localTime = Number(record.updatedAt) || 0;
                        const driveTime = Date.parse(file.modifiedTime || '') || 0;
                        if (localTime >= driveTime) {
                            record = await this._prepareRecordForDrive(item.card, record);
                            await this._uploadRecord(item.card, item.descriptor, record, file);
                        } else {
                            const restored = await this._downloadRecord(item.card, file);
                            recordsById.set(restored.id, restored);
                            changedLocalImages = true;
                        }
                    }
                }

                this._state.progressDone += 1;
                this._emitStatus();
            }

            for (const file of staleFiles) {
                await this._deleteFile(file.id);
                this._state.progressDone += 1;
                this._emitStatus();
            }

            if (staleFiles.length > 0) this._filesPromise = null;

            this._state.lastSyncAt = new Date().toISOString();
            this._state.lastError = '';
            this._state.needsSync = false;
            await this._persistState();
            this._setStatus('synced');
            if (changedLocalImages) {
                window.dispatchEvent(new CustomEvent('portal-atlas-drive-images-changed'));
            }
            return { total: descriptors.length, deleted: staleFiles.length, restored: changedLocalImages };
        } catch (error) {
            this._state.needsSync = true;
            await this._persistState();
            this._setStatus(navigator.onLine ? 'error' : 'offline', error.message);
            throw error;
        }
    },

    async restoreCardImage(card) {
        if (!this._state.enabled || !this.isConfigured() || !navigator.onLine) return null;
        const descriptor = await this._descriptorForCard(card);
        if (!descriptor) return null;

        try {
            await this._getAuthToken(false);
            const files = await this._listFiles();
            const file = files.find(candidate => candidate.name === descriptor.name);
            if (!file) return null;
            return await this._downloadRecord(card, file);
        } catch (error) {
            console.warn('Unable to restore card image from Drive:', error);
            return null;
        }
    },

    async _descriptorForCard(card) {
        const mediaId = mediaStorage.getIdForCard(card);
        if (!mediaId) return null;
        const identity = card.imageKind === 'local'
            ? `${mediaId}:${card.imageRevision || 'legacy'}`
            : mediaId;
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)));
        const key = [...digest.subarray(0, 20)]
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
        return { key, name: `${CONFIG.DRIVE.FILE_PREFIX}${key}.image` };
    },

    async _downloadRecord(card, file) {
        const response = await this._apiFetch(`${CONFIG.DRIVE.API_ROOT}/files/${encodeURIComponent(file.id)}?alt=media`);
        const downloaded = await response.blob();
        const mimeType = file.mimeType || downloaded.type || 'image/webp';
        const typedBlob = downloaded.type ? downloaded : new Blob([downloaded], { type: mimeType });
        const variants = await mediaStorage.prepareImageVariants(typedBlob, { includeQuality: false });
        const record = await mediaStorage.put({
            id: mediaStorage.getIdForCard(card),
            blob: variants.blob,
            qualityBlob: null,
            sourceType: card.imageKind === 'local' ? 'local' : 'url',
            sourceUrl: card.imageKind === 'url' ? mediaStorage.normalizeUrl(card.backgroundImage) : '',
            width: variants.width,
            height: variants.height,
            qualityWidth: 0,
            qualityHeight: 0,
            lastCheckedAt: card.imageKind === 'url' ? Date.now() : 0,
            updatedAt: Date.parse(file.modifiedTime || '') || Date.now(),
            revision: card.imageKind === 'local' ? (card.imageRevision || file.appProperties?.cardRevision || '') : '',
            contentRevision: file.appProperties?.contentRevision || ''
        });
        return { ...record, displayBlob: typedBlob };
    },

    async _prepareRecordForDrive(card, record) {
        if (!record || record.qualityBlob || card.imageKind !== 'url') return record;
        const remoteUrl = mediaStorage.normalizeUrl(card.backgroundImage);
        if (!remoteUrl) return record;
        try {
            return await mediaStorage.cacheRemoteImage(remoteUrl, null, { includeQuality: true });
        } catch (error) {
            // If the source has disappeared, the 400px preview is still more
            // valuable in Drive than having no recoverable copy at all.
            console.warn('Unable to recreate a high-quality remote image; uploading its preview:', error);
            return record;
        }
    },

    async _uploadRecord(card, descriptor, record, existingFile) {
        const blob = record.qualityBlob || record.blob;
        const contentRevision = record.contentRevision || await mediaStorage.fingerprintBlob(blob);
        const metadata = {
            name: descriptor.name,
            appProperties: {
                portalAtlas: String(CONFIG.SCHEMA_VERSION),
                assetKey: descriptor.key,
                sourceType: card.imageKind === 'local' ? 'local' : 'url',
                cardRevision: card.imageKind === 'local' ? (card.imageRevision || record.revision || '') : '',
                contentRevision
            }
        };
        if (!existingFile) metadata.parents = ['appDataFolder'];

        const boundary = `portal_atlas_${crypto.randomUUID().replaceAll('-', '')}`;
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
            JSON.stringify(metadata),
            `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
            blob,
            `\r\n--${boundary}--`
        ]);
        const path = existingFile
            ? `${CONFIG.DRIVE.UPLOAD_ROOT}/files/${encodeURIComponent(existingFile.id)}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,appProperties`
            : `${CONFIG.DRIVE.UPLOAD_ROOT}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,appProperties`;
        const response = await this._apiFetch(path, {
            method: existingFile ? 'PATCH' : 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
        const uploaded = await response.json();
        this._filesPromise = null;
        if (record.qualityBlob) await mediaStorage.discardQuality(record.id);
        return uploaded;
    },

    async _deleteFile(fileId) {
        if (!fileId) return;
        await this._apiFetch(`${CONFIG.DRIVE.API_ROOT}/files/${encodeURIComponent(fileId)}`, {
            method: 'DELETE',
            allowNotFound: true
        });
    },

    async _listFiles() {
        if (this._filesPromise) return this._filesPromise;
        this._filesPromise = (async () => {
            const files = [];
            let pageToken = '';
            do {
                const params = new URLSearchParams({
                    spaces: 'appDataFolder',
                    q: `trashed = false and name contains '${CONFIG.DRIVE.FILE_PREFIX}'`,
                    pageSize: '1000',
                    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,appProperties)'
                });
                if (pageToken) params.set('pageToken', pageToken);
                const response = await this._apiFetch(`${CONFIG.DRIVE.API_ROOT}/files?${params}`);
                const payload = await response.json();
                files.push(...(payload.files || []));
                pageToken = payload.nextPageToken || '';
            } while (pageToken);
            return files;
        })().catch(error => {
            this._filesPromise = null;
            throw error;
        });
        return this._filesPromise;
    },

    async _apiFetch(url, options = {}, retry = true) {
        const token = await this._getAuthToken(false);
        const { allowNotFound = false, ...requestOptions } = options;
        const headers = new Headers(requestOptions.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        const response = await fetch(url, { ...requestOptions, headers });
        if (response.status === 401 && retry) {
            await this._removeCachedToken(token);
            return this._apiFetch(url, options, false);
        }
        if (allowNotFound && response.status === 404) return response;
        if (!response.ok) {
            let detail = '';
            try { detail = (await response.json())?.error?.message || ''; } catch (_) { /* no JSON body */ }
            throw new Error(detail || `Google Drive request failed (${response.status})`);
        }
        return response;
    },

    async _getAuthToken(interactive) {
        if (this._token) return this._token;
        const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({
                interactive: Boolean(interactive),
                scopes: [CONFIG.DRIVE.SCOPE],
                enableGranularPermissions: true
            }, result => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve(typeof result === 'string' ? result : result?.token);
            });
        });
        if (!token) throw new Error('Google did not return an authorization token');
        this._token = token;
        return token;
    },

    async _removeCachedToken(token) {
        this._token = '';
        await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
    },

    _setupRetryListeners() {
        if (this._listenersReady) return;
        this._listenersReady = true;
        window.addEventListener('online', () => {
            if (!this._state.enabled) return;
            this._setStatus('idle');
            if (this._state.needsSync) this._scheduleSync(300);
        });
        window.addEventListener('offline', () => {
            if (this._state.enabled) this._setStatus('offline');
        });
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'sync' || !changes[CONFIG.DRIVE.ENABLED_SYNC_KEY]) return;
            const enabled = changes[CONFIG.DRIVE.ENABLED_SYNC_KEY].newValue === true;
            if (enabled === this._state.enabled) return;
            this._state.enabled = enabled;
            this._state.status = enabled ? 'idle' : 'disconnected';
            this._persistState().catch(error => console.warn('Unable to mirror Drive preference:', error));
            this._emitStatus();
            if (enabled && this.isConfigured() && navigator.onLine) {
                this._getAuthToken(false).then(() => {
                    this._scheduleSync(300);
                }).catch(error => this._setStatus('authorization_required', error.message));
            } else if (!enabled) {
                clearTimeout(this._retryTimer);
                this._retryTimer = null;
            }
        });
    },

    _scheduleSync(delay) {
        clearTimeout(this._retryTimer);
        this._retryTimer = setTimeout(() => {
            this.syncAll().catch(error => console.warn('Scheduled Drive sync failed:', error));
        }, delay);
    },

    _setStatus(status, error = '') {
        this._state.status = status;
        this._state.lastError = error || '';
        this._emitStatus();
    },

    _emitStatus() {
        window.dispatchEvent(new CustomEvent('portal-atlas-drive-status', {
            detail: this.getState()
        }));
    },

    async _getLocalState() {
        return new Promise(resolve => {
            chrome.storage.local.get([CONFIG.DRIVE.STATE_KEY], result => {
                resolve(result[CONFIG.DRIVE.STATE_KEY] || {});
            });
        });
    },

    async _getSyncedPreference() {
        return new Promise(resolve => {
            chrome.storage.sync.get([CONFIG.DRIVE.ENABLED_SYNC_KEY], result => {
                resolve({
                    exists: Object.prototype.hasOwnProperty.call(result, CONFIG.DRIVE.ENABLED_SYNC_KEY),
                    enabled: result[CONFIG.DRIVE.ENABLED_SYNC_KEY] === true
                });
            });
        });
    },

    async _setSyncedPreference(enabled) {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [CONFIG.DRIVE.ENABLED_SYNC_KEY]: Boolean(enabled) }, () => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve();
            });
        });
    },

    async _persistState() {
        const persistent = {
            enabled: Boolean(this._state.enabled),
            lastSyncAt: this._state.lastSyncAt || '',
            lastError: this._state.lastError || '',
            needsSync: Boolean(this._state.needsSync)
        };
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [CONFIG.DRIVE.STATE_KEY]: persistent }, () => {
                const error = chrome.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve();
            });
        });
    }
};
