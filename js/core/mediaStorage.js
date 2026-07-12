const mediaStorage = {
    _dbPromise: null,
    _mutationChain: Promise.resolve(),

    async initialize() {
        await this._openDatabase();
    },

    _openDatabase() {
        if (this._dbPromise) return this._dbPromise;

        this._dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(CONFIG.MEDIA.DB_NAME, CONFIG.MEDIA.DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(CONFIG.MEDIA.STORE_NAME)) {
                    db.createObjectStore(CONFIG.MEDIA.STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    this._dbPromise = null;
                };
                resolve(db);
            };
            request.onerror = () => {
                this._dbPromise = null;
                reject(request.error || new Error('Unable to open image database'));
            };
            request.onblocked = () => {
                console.warn('Image database upgrade is waiting for another Portal Atlas tab to close');
            };
        });

        return this._dbPromise;
    },

    _enqueueMutation(operation) {
        const result = this._mutationChain.then(operation, operation);
        this._mutationChain = result.catch(() => undefined);
        return result;
    },

    _assertImageBlob(blob) {
        if (!(blob instanceof Blob) || blob.size === 0 || !/^image\//i.test(blob.type || '')) {
            throw new Error('The selected file is not a valid image');
        }
    },

    remoteId(url) {
        return `url:${this.normalizeUrl(url)}`;
    },

    localId(cardId) {
        return `local:${cardId}`;
    },

    normalizeUrl(url) {
        if (typeof url !== 'string') return '';
        const trimmed = url.trim();
        const cssUrl = trimmed.match(/^url\(\s*(["']?)([\s\S]*)\1\s*\)$/i);
        return cssUrl ? cssUrl[2].trim() : trimmed;
    },

    getIdForCard(card) {
        const imageKind = card?.imageKind || (this.normalizeUrl(card?.backgroundImage) ? 'url' : 'none');
        if (imageKind === 'local') return this.localId(card.id);

        const url = this.normalizeUrl(card?.backgroundImage);
        return url ? this.remoteId(url) : null;
    },

    async get(id) {
        if (!id) return null;
        return this._request('readonly', store => store.get(id));
    },

    async getForCard(card) {
        return this.get(this.getIdForCard(card));
    },

    async getAll() {
        return this._request('readonly', store => store.getAll());
    },

    async put(record) {
        if (!record?.id || !(record.blob instanceof Blob)) {
            throw new Error('Invalid image record');
        }
        this._assertImageBlob(record.blob);
        if (record.qualityBlob != null) this._assertImageBlob(record.qualityBlob);

        const sourceType = record.sourceType || 'local';
        const normalizedRecord = {
            id: record.id,
            blob: record.blob,
            qualityBlob: record.qualityBlob instanceof Blob ? record.qualityBlob : null,
            sourceType,
            sourceUrl: record.sourceUrl || '',
            width: Number(record.width) || 0,
            height: Number(record.height) || 0,
            qualityWidth: Number(record.qualityWidth) || 0,
            qualityHeight: Number(record.qualityHeight) || 0,
            updatedAt: Number.isFinite(Number(record.updatedAt))
                ? Number(record.updatedAt)
                : Date.now(),
            revision: record.revision || (sourceType === 'local'
                ? await this.fingerprintBlob(record.qualityBlob instanceof Blob ? record.qualityBlob : record.blob)
                : ''),
            contentRevision: record.contentRevision || await this.fingerprintBlob(
                record.qualityBlob instanceof Blob ? record.qualityBlob : record.blob
            )
        };

        await this._enqueueMutation(() => this._request('readwrite', store => store.put(normalizedRecord)));
        return normalizedRecord;
    },

    async remove(id) {
        if (!id) return;
        await this._enqueueMutation(() => this._request('readwrite', store => store.delete(id)));
    },

    async clear() {
        await this._enqueueMutation(() => this._request('readwrite', store => store.clear()));
    },

    async replaceAll(records) {
        if (!Array.isArray(records) || records.some(record => (
            !record?.id
            || !(record.blob instanceof Blob)
            || record.blob.size === 0
            || !/^image\//i.test(record.blob.type || '')
            || record.qualityBlob != null && (
                !(record.qualityBlob instanceof Blob)
                || record.qualityBlob.size === 0
                || !/^image\//i.test(record.qualityBlob.type || '')
            )
        ))) {
            throw new Error('Invalid image replacement set');
        }

        return this._enqueueMutation(async () => {
            const db = await this._openDatabase();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(CONFIG.MEDIA.STORE_NAME, 'readwrite');
                const store = transaction.objectStore(CONFIG.MEDIA.STORE_NAME);
                store.clear();
                records.forEach(record => store.put(record));

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error || new Error('Unable to replace images'));
                transaction.onabort = () => reject(transaction.error || new Error('Image replacement was aborted'));
            });
        });
    },

    async cleanupUnused(cards) {
        const fallbackCards = Array.isArray(cards) ? cards : [];
        return this._enqueueMutation(async () => {
            let currentCards = fallbackCards;
            try {
                if (typeof dataManager !== 'undefined' && typeof dataManager.getAllCards === 'function') {
                    currentCards = await dataManager.getAllCards();
                }
            } catch (error) {
                console.warn('Unable to revalidate cards before cleaning image cache:', error);
                // If current references cannot be verified, deleting nothing
                // is safer than removing a user's last valid image preview.
                return;
            }

            const usedIds = new Set(currentCards.map(card => this.getIdForCard(card)).filter(Boolean));
            const records = await this.getAll();
            const staleIds = records
                .filter(record => !usedIds.has(record.id))
                .map(record => record.id);
            if (staleIds.length === 0) return;

            const db = await this._openDatabase();
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(CONFIG.MEDIA.STORE_NAME, 'readwrite');
                const store = transaction.objectStore(CONFIG.MEDIA.STORE_NAME);
                staleIds.forEach(id => store.delete(id));
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error || new Error('Unable to clean image cache'));
                transaction.onabort = () => reject(transaction.error || new Error('Image cache cleanup was aborted'));
            });
        });
    },

    async storeLocalImage(cardId, blob) {
        const optimized = await this.prepareImageVariants(blob);
        return this.put({
            id: this.localId(cardId),
            blob: optimized.blob,
            qualityBlob: optimized.qualityBlob,
            sourceType: 'local',
            width: optimized.width,
            height: optimized.height,
            qualityWidth: optimized.qualityWidth,
            qualityHeight: optimized.qualityHeight,
            updatedAt: Date.now()
        });
    },

    async cacheRemoteImage(url, sourceBlob = null) {
        const normalizedUrl = this.normalizeUrl(url);
        if (!normalizedUrl) throw new Error('Invalid remote image URL');

        const previous = await this.get(this.remoteId(normalizedUrl));
        const responseBlob = sourceBlob || await this.fetchRemoteBlob(normalizedUrl);
        const optimized = await this.prepareImageVariants(responseBlob);

        const record = await this.put({
            id: this.remoteId(normalizedUrl),
            blob: optimized.blob,
            qualityBlob: optimized.qualityBlob,
            sourceType: 'url',
            sourceUrl: normalizedUrl,
            width: optimized.width,
            height: optimized.height,
            qualityWidth: optimized.qualityWidth,
            qualityHeight: optimized.qualityHeight,
            updatedAt: Date.now()
        });
        return {
            ...record,
            displayBlob: record.qualityBlob || record.blob,
            contentChanged: previous?.contentRevision !== record.contentRevision
        };
    },

    async fetchRemoteBlob(url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        try {
            const response = await fetch(this.normalizeUrl(url), {
                cache: 'default',
                credentials: 'omit',
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`Image request failed with status ${response.status}`);
            }

            const mimeType = (response.headers.get('content-type') || '')
                .split(';', 1)[0]
                .trim()
                .toLowerCase();
            if (!mimeType.startsWith('image/')) {
                throw new Error(`Image request returned unsupported content type: ${mimeType || 'unknown'}`);
            }

            const blob = await response.blob();
            const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
            this._assertImageBlob(typedBlob);
            return typedBlob;
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error('Image request timed out after 15 seconds');
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    },

    async optimizeBlob(blob, options = {}) {
        this._assertImageBlob(blob);
        const mimeType = (blob.type || '').split(';', 1)[0].toLowerCase();
        const preserveOriginalMedia = options.preserveOriginalMedia === true;

        if (mimeType === 'image/svg+xml') {
            const svgHeader = await blob.slice(0, Math.min(blob.size, 64 * 1024)).text();
            if (!/<svg(?:\s|>)/i.test(svgHeader)) {
                throw new Error('The selected SVG is invalid');
            }
            // SVG remains resolution-independent, so rasterizing it would
            // increase its size and discard vector fidelity.
            return { blob, width: 0, height: 0 };
        }

        const animated = await this._isAnimatedImage(blob, mimeType);
        if (animated) {
            let dimensions;
            try {
                dimensions = await this._readBitmapDimensions(blob);
            } catch (error) {
                if (preserveOriginalMedia) return { blob, width: 0, height: 0 };
                throw error;
            }

            // Resizing through canvas would silently flatten the animation.
            // Preserve it as the explicit exception to the 400px raster rule.
            return { blob, width: dimensions.width, height: dimensions.height };
        }

        let bitmap;
        try {
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch (error) {
            if (preserveOriginalMedia) return { blob, width: 0, height: 0 };
            throw new Error('The selected image could not be decoded');
        }

        try {
            const maxDimension = Number(options.maxDimension) || CONFIG.MEDIA.MAX_DIMENSION;
            return this._createOptimizedFromBitmap(blob, bitmap, maxDimension,
                Number(options.quality) || CONFIG.MEDIA.WEBP_QUALITY,
                options.preferOriginalWithinBounds === true);
        } finally {
            bitmap.close?.();
        }
    },

    async prepareImageVariants(blob) {
        this._assertImageBlob(blob);
        const mimeType = (blob.type || '').split(';', 1)[0].toLowerCase();
        if (mimeType === 'image/svg+xml' || await this._isAnimatedImage(blob, mimeType)) {
            const preserved = await this.optimizeBlob(blob, { preserveOriginalMedia: true });
            return {
                blob: preserved.blob,
                width: preserved.width,
                height: preserved.height,
                qualityBlob: null,
                qualityWidth: preserved.width,
                qualityHeight: preserved.height
            };
        }

        let bitmap;
        try {
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            const preview = await this._createOptimizedFromBitmap(
                blob, bitmap, CONFIG.MEDIA.MAX_DIMENSION, CONFIG.MEDIA.WEBP_QUALITY, false
            );
            const quality = await this._createOptimizedFromBitmap(
                blob, bitmap, CONFIG.MEDIA.QUALITY_MAX_DIMENSION, CONFIG.MEDIA.QUALITY_WEBP_QUALITY, true
            );

            const sameBlob = quality.blob === preview.blob;
            return {
                blob: preview.blob,
                width: preview.width,
                height: preview.height,
                qualityBlob: sameBlob ? null : quality.blob,
                qualityWidth: quality.width,
                qualityHeight: quality.height
            };
        } catch (error) {
            throw new Error('The selected image could not be decoded');
        } finally {
            bitmap?.close?.();
        }
    },

    async _createOptimizedFromBitmap(sourceBlob, bitmap, maxDimension, quality, preferOriginalWithinBounds) {
        const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        if (scale === 1 && preferOriginalWithinBounds) return { blob: sourceBlob, width, height };

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: true });
        if (!context) throw new Error('Unable to prepare the image canvas');
        context.drawImage(bitmap, 0, 0, width, height);
        const optimizedBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!optimizedBlob) throw new Error('Unable to encode the optimized image');

        if (scale === 1 && optimizedBlob.size >= sourceBlob.size) {
            return { blob: sourceBlob, width, height };
        }
        return { blob: optimizedBlob, width, height };
    },

    async _readBitmapDimensions(blob) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            return { width: bitmap.width, height: bitmap.height };
        } catch (error) {
            throw new Error('The selected image could not be decoded');
        } finally {
            bitmap?.close?.();
        }
    },

    async _isAnimatedImage(blob, mimeType) {
        if (mimeType === 'image/gif' || mimeType === 'image/avif-sequence') return true;
        if (mimeType !== 'image/webp' && mimeType !== 'image/png') return false;

        const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 1024 * 1024)).arrayBuffer());
        const markerBytes = new TextEncoder().encode(mimeType === 'image/webp' ? 'ANIM' : 'acTL');
        outer: for (let index = 0; index <= bytes.length - markerBytes.length; index += 1) {
            for (let offset = 0; offset < markerBytes.length; offset += 1) {
                if (bytes[index + offset] !== markerBytes[offset]) continue outer;
            }
            return true;
        }
        return false;
    },

    dataUrlToBlob(dataUrl) {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            throw new Error('Invalid embedded image');
        }

        const commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0) throw new Error('Invalid embedded image');

        const header = dataUrl.slice(0, commaIndex);
        const payload = dataUrl.slice(commaIndex + 1);
        const mimeMatch = header.match(/^data:([^;,]+)/);
        const mimeType = mimeMatch?.[1] || 'application/octet-stream';
        let bytes;
        if (header.includes(';base64')) {
            const binary = atob(payload);
            bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        } else {
            bytes = new TextEncoder().encode(decodeURIComponent(payload));
        }
        return new Blob([bytes], { type: mimeType });
    },

    async fingerprintBlob(blob) {
        this._assertImageBlob(blob);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
        return [...digest.subarray(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    },

    async blobToDataUrl(blob) {
        const buffer = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < buffer.length; index += chunkSize) {
            binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
        }
        return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
    },

    async recordsToPortable(records) {
        return Promise.all(records.map(async record => ({
            id: record.id,
            sourceType: record.sourceType,
            sourceUrl: record.sourceUrl || '',
            width: record.width || 0,
            height: record.height || 0,
            qualityWidth: record.qualityWidth || 0,
            qualityHeight: record.qualityHeight || 0,
            updatedAt: record.updatedAt || 0,
            revision: record.revision || '',
            contentRevision: record.contentRevision || '',
            data: await this.blobToDataUrl(record.blob),
            qualityData: record.qualityBlob instanceof Blob
                ? await this.blobToDataUrl(record.qualityBlob)
                : ''
        })));
    },

    portableToRecords(records) {
        if (!Array.isArray(records)) return [];
        return records.map(record => ({
            id: record.id,
            sourceType: record.sourceType || 'local',
            sourceUrl: record.sourceUrl || '',
            width: Number(record.width) || 0,
            height: Number(record.height) || 0,
            qualityWidth: Number(record.qualityWidth) || 0,
            qualityHeight: Number(record.qualityHeight) || 0,
            updatedAt: Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : Date.now(),
            revision: record.revision || '',
            contentRevision: record.contentRevision || '',
            blob: this.dataUrlToBlob(record.data),
            qualityBlob: record.qualityData ? this.dataUrlToBlob(record.qualityData) : null
        }));
    },

    async migrateLegacyPreviews(cards) {
        const recordsById = new Map();
        const migratedCards = [];

        for (const originalCard of cards) {
            const card = { ...originalCard };
            const remoteUrl = this.normalizeUrl(card.backgroundImage);
            const embeddedOriginal = remoteUrl.startsWith('data:') ? remoteUrl : '';
            const legacyPreview = card.backgroundImageBase64;

            if (embeddedOriginal) {
                const blob = this.dataUrlToBlob(embeddedOriginal);
                const optimized = await this.prepareImageVariants(blob);
                const revision = await this.fingerprintBlob(optimized.qualityBlob || optimized.blob);
                recordsById.set(this.localId(card.id), {
                    id: this.localId(card.id),
                    blob: optimized.blob,
                    qualityBlob: optimized.qualityBlob,
                    sourceType: 'local',
                    sourceUrl: '',
                    width: optimized.width,
                    height: optimized.height,
                    qualityWidth: optimized.qualityWidth,
                    qualityHeight: optimized.qualityHeight,
                    updatedAt: Date.now(),
                    revision
                });
                card.backgroundImage = '';
                card.imageKind = 'local';
                card.imageRevision = revision;
            } else if (legacyPreview) {
                // V1 previews are already at most 200x200. Store their binary
                // bytes as-is: no quality loss and no accidental upscaling.
                try {
                    const blob = this.dataUrlToBlob(legacyPreview);
                    this._assertImageBlob(blob);
                    const id = remoteUrl ? this.remoteId(remoteUrl) : this.localId(card.id);
                    const revision = remoteUrl ? '' : await this.fingerprintBlob(blob);
                    if (!recordsById.has(id)) {
                        recordsById.set(id, {
                            id,
                            blob,
                            sourceType: remoteUrl ? 'url' : 'local',
                            sourceUrl: remoteUrl,
                            width: 0,
                            height: 0,
                            updatedAt: remoteUrl ? 0 : Date.now(),
                            revision
                        });
                    }
                    if (!remoteUrl) card.imageRevision = revision;
                } catch (error) {
                    // A remote preview is disposable because its URL remains
                    // available. A local-only preview is the user's source
                    // image, so migration must stop rather than discard it.
                    if (!remoteUrl) throw error;
                    console.warn(`Ignoring invalid preview for card ${card.id}:`, error);
                }
                card.imageKind = remoteUrl ? 'url' : 'local';
            } else {
                card.imageKind = remoteUrl ? 'url' : (card.imageKind || 'none');
            }

            delete card.backgroundImageBase64;
            migratedCards.push(card);
        }

        return { cards: migratedCards, records: [...recordsById.values()] };
    },

    async _request(mode, createRequest) {
        const db = await this._openDatabase();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(CONFIG.MEDIA.STORE_NAME, mode);
            const store = transaction.objectStore(CONFIG.MEDIA.STORE_NAME);
            let request;

            try {
                request = createRequest(store);
            } catch (error) {
                reject(error);
                return;
            }

            let result = null;
            request.onsuccess = () => {
                result = request.result ?? null;
                if (mode === 'readonly') resolve(result);
            };
            request.onerror = () => reject(request.error || new Error('Image database request failed'));
            if (mode !== 'readonly') transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(transaction.error || new Error('Image database transaction was aborted'));
        });
    }
};
