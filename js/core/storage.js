const storage = {
    _cards: new Map(),
    _wrappers: new Map(),
    _wrapperStates: {},
    _highestDefaultNum: -1,
    _initialized: false,
    _syncListenerRegistered: false,
    _syncSnapshotReady: false,
    _reconcileScheduled: false,
    _reconcileRequested: false,

    async initialize() {
        if (this._initialized) return;

        await mediaStorage.initialize();
        const [localItems, syncItems] = await Promise.all([
            this._areaGet('local', null),
            this._areaGet('sync', null)
        ]);

        const hasSyncV2Marker = syncItems[CONFIG.STORAGE_KEYS.V2_SCHEMA] === CONFIG.SCHEMA_VERSION;
        const hasCompleteSyncV2 = this._isCompleteSyncSnapshot(syncItems);
        const hasLocalV2 = localItems[CONFIG.STORAGE_KEYS.V2_SCHEMA] === CONFIG.SCHEMA_VERSION;
        const legacyCards = Array.isArray(localItems[CONFIG.STORAGE_KEYS.CARDS])
            ? localItems[CONFIG.STORAGE_KEYS.CARDS]
            : [];
        const legacyWrappers = Array.isArray(syncItems[CONFIG.STORAGE_KEYS.WRAPPERS])
            ? syncItems[CONFIG.STORAGE_KEYS.WRAPPERS]
            : [];

        if (hasCompleteSyncV2) {
            // Once another PC has completed the migration, Sync is the active
            // metadata source. Old local Base64 values are useful only as an
            // offline cache; uploading them could resurrect stale cards.
            let legacyMediaReady = true;
            if (legacyCards.length > 0) {
                legacyMediaReady = await this._seedLegacyMedia(legacyCards);
            }
            this._syncSnapshotReady = true;
            await this._loadAndMergeV2(localItems, syncItems, {
                flushPending: true,
                removeLegacy: legacyMediaReady
            });
        } else if (hasLocalV2) {
            await this._loadLocalV2(localItems);
            // The local mirror records which entries are genuinely pending.
            // Reopening a tab must not turn every card into a new Sync write,
            // especially while a newer remote commit is still arriving.
            if (hasSyncV2Marker) {
                const status = localItems[CONFIG.STORAGE_KEYS.V2_SYNC_STATUS] || {};
                const hasPendingWork = [...this._cards.values(), ...this._wrappers.values()]
                    .some(entry => entry.pending)
                    || (status.pendingDeletes || []).length > 0
                    || Object.keys(status.pendingScalars || {}).length > 0;
                this._syncSnapshotReady = false;
                if (hasPendingWork) await this._ensureWritableSnapshot();
            } else {
                // Sync was cleared or never committed. Republish the complete
                // local mirror rather than only a subset of pending records.
                this._syncSnapshotReady = false;
                await this._ensureWritableSnapshot();
            }
        } else if (hasSyncV2Marker) {
            // A schema marker can arrive before its per-card records. Keep v1
            // as the visible fallback and wait for a verifiable commit rather
            // than activating or deleting a partial remote snapshot.
            await this._loadLegacyFallback(localItems, syncItems, legacyCards, legacyWrappers);
            this._syncSnapshotReady = false;
        } else if (legacyCards.length > 0 || legacyWrappers.length > 0) {
            this._syncSnapshotReady = true;
            await this._migrateLegacy(localItems, syncItems, legacyCards, legacyWrappers);
        } else {
            this._wrapperStates = {};
            this._highestDefaultNum = -1;
            await this._areaSet('local', {
                [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
                [CONFIG.STORAGE_KEYS.V2_STATES]: {},
                [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: -1
            });
            try {
                await this._writeSyncChanges({
                    [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
                    [CONFIG.STORAGE_KEYS.V2_STATES]: {},
                    [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: -1
                }, []);
                this._syncSnapshotReady = true;
            } catch (error) {
                await this._queuePendingScalars({
                    [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
                    [CONFIG.STORAGE_KEYS.V2_STATES]: {},
                    [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: -1
                });
                await this._recordSyncError(error);
                this._syncSnapshotReady = true;
            }
        }

        this._initialized = true;
        this._registerSyncListener();
    },

    async isStorageEmpty() {
        await this.initialize();
        // Do not install defaults while a remote v2 commit is still arriving;
        // doing so would turn a transient partial snapshot into a competing
        // complete dataset.
        if (!this._syncSnapshotReady) return false;
        const isEmpty = this._cards.size === 0 && this._wrappers.size === 0;
        if (isEmpty) await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, -1);
        return isEmpty;
    },

    async initializeDefaultData() {
        const isFirstTime = await this.isStorageEmpty();

        if (isFirstTime) {
            await this.set(CONFIG.STORAGE_KEYS.WRAPPERS, DEFAULT_DATA.wrappers);
            await this.set(CONFIG.STORAGE_KEYS.CARDS, DEFAULT_DATA.cards);

            let initialHighest = -1;
            DEFAULT_DATA.cards.forEach(card => {
                const match = card.id.match(/^default-card-(\d+)$/);
                if (match) initialHighest = Math.max(initialHighest, parseInt(match[1], 10));
            });
            await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, initialHighest);
            return true;
        }

        try {
            const existingCards = await this.get(CONFIG.STORAGE_KEYS.CARDS);
            const defaultCardPattern = /^default-card-(\d+)$/;
            let highestDefaultNum = await this.get(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM);

            if (highestDefaultNum === undefined || highestDefaultNum === null) {
                highestDefaultNum = -1;
                existingCards.forEach(card => {
                    const match = card.id.match(defaultCardPattern);
                    if (match) highestDefaultNum = Math.max(highestDefaultNum, parseInt(match[1], 10));
                });
                await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, highestDefaultNum);
            }

            let maxNewDefaultNum = -1;
            DEFAULT_DATA.cards.forEach(card => {
                const match = card.id.match(defaultCardPattern);
                if (match) maxNewDefaultNum = Math.max(maxNewDefaultNum, parseInt(match[1], 10));
            });

            if (maxNewDefaultNum <= highestDefaultNum) return false;

            const newDefaultCards = DEFAULT_DATA.cards.filter(card => {
                const match = card.id.match(defaultCardPattern);
                return match && parseInt(match[1], 10) > highestDefaultNum;
            });
            if (newDefaultCards.length === 0) return false;

            const wrappers = await this.get(CONFIG.STORAGE_KEYS.WRAPPERS);
            const mainWrapper = wrappers.find(wrapper => wrapper.order === 0);
            if (!mainWrapper) return false;

            const cards = existingCards.concat(newDefaultCards.map((card, index) => ({
                ...card,
                wrapperId: mainWrapper.id,
                order: existingCards.length + index
            })));
            await this.set(CONFIG.STORAGE_KEYS.CARDS, cards);
            await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, maxNewDefaultNum);
            return true;
        } catch (error) {
            console.error('Error managing new default cards:', error);
            return false;
        }
    },

    async get(key) {
        await this.initialize();

        switch (key) {
            case CONFIG.STORAGE_KEYS.CARDS:
                return [...this._cards.values()].map(entry => this._clone(entry.data));
            case CONFIG.STORAGE_KEYS.WRAPPERS:
                return [...this._wrappers.values()].map(entry => this._clone(entry.data));
            case CONFIG.STORAGE_KEYS.WRAPPER_STATES:
                return this._clone(this._wrapperStates);
            case CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM:
                return this._highestDefaultNum;
            default:
                return undefined;
        }
    },

    async set(key, data) {
        await this.initialize();
        await this._ensureWritableSnapshot();

        switch (key) {
            case CONFIG.STORAGE_KEYS.CARDS:
                return this._replaceCards(data);
            case CONFIG.STORAGE_KEYS.WRAPPERS:
                return this._replaceWrappers(data);
            case CONFIG.STORAGE_KEYS.WRAPPER_STATES:
                return this._setWrapperStates(data);
            case CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM:
                return this._setHighestDefaultNum(data);
            default:
                throw new Error(`Unknown storage key: ${key}`);
        }
    },

    async replaceAllData({ cards, wrappers, wrapperStates = {}, highestDefaultNum = -1 }) {
        if (!Array.isArray(cards) || !Array.isArray(wrappers)) {
            throw new Error('Cards and wrappers must be arrays');
        }

        const normalizedCards = cards.map(card => this._normalizeCard(card));
        const normalizedWrappers = wrappers.map(wrapper => this._normalizeWrapper(wrapper));
        this._validateUniqueIds(normalizedCards, 'card');
        this._validateUniqueIds(normalizedWrappers, 'wrapper');
        this._syncSnapshotReady = true;

        const newLocalValues = {
            [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
            [CONFIG.STORAGE_KEYS.V2_STATES]: this._normalizeStates(wrapperStates),
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: Number.isFinite(Number(highestDefaultNum))
                ? Number(highestDefaultNum)
                : -1
        };
        const newSyncValues = {
            [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
            [CONFIG.STORAGE_KEYS.V2_STATES]: newLocalValues[CONFIG.STORAGE_KEYS.V2_STATES],
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: newLocalValues[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]
        };

        normalizedCards.forEach(card => {
            const key = this._cardKey(card.id);
            newLocalValues[key] = { data: card, pending: true };
            newSyncValues[key] = this._encodeCard(card);
        });
        normalizedWrappers.forEach(wrapper => {
            const key = this._wrapperKey(wrapper.id);
            newLocalValues[key] = { data: wrapper, pending: true };
            newSyncValues[key] = this._encodeWrapper(wrapper);
        });

        this._assertSyncPayloadFits(newSyncValues);

        const [localItems, syncItems] = await Promise.all([
            this._areaGet('local', null),
            this._areaGet('sync', null)
        ]);
        const localEntityKeys = Object.keys(localItems).filter(key => this._isEntityKey(key));
        const syncEntityKeys = Object.keys(syncItems).filter(key => this._isEntityKey(key));
        const retainedKeys = new Set(Object.keys(newSyncValues));
        const localKeysToRemove = localEntityKeys.filter(key => !retainedKeys.has(key));
        const syncKeysToRemove = syncEntityKeys.filter(key => !retainedKeys.has(key));

        await this._areaSet('local', newLocalValues);
        await this._queuePendingDeletes(syncKeysToRemove);
        await this._queuePendingScalars({
            [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
            [CONFIG.STORAGE_KEYS.V2_STATES]: newLocalValues[CONFIG.STORAGE_KEYS.V2_STATES],
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: newLocalValues[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]
        });
        if (localKeysToRemove.length > 0) await this._areaRemove('local', localKeysToRemove);

        this._cards = new Map(normalizedCards.map(card => [card.id, { data: card, pending: true }]));
        this._wrappers = new Map(normalizedWrappers.map(wrapper => [wrapper.id, { data: wrapper, pending: true }]));
        this._wrapperStates = this._clone(newLocalValues[CONFIG.STORAGE_KEYS.V2_STATES]);
        this._highestDefaultNum = newLocalValues[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM];

        let synced = false;
        try {
            await this._writeSyncChanges(newSyncValues, syncKeysToRemove);
            await this._markEntitiesSynced(Object.keys(newSyncValues).filter(key => this._isEntityKey(key)));
            await this._clearPendingDeletes(syncKeysToRemove);
            await this._clearPendingScalars([
                CONFIG.STORAGE_KEYS.V2_SCHEMA,
                CONFIG.STORAGE_KEYS.V2_STATES,
                CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM
            ]);
            synced = true;
        } catch (error) {
            await this._recordSyncError(error);
        }

        return { synced };
    },

    async getSyncUsage() {
        const items = await this._areaGet('sync', null);
        const relevantItems = Object.fromEntries(
            Object.entries(items).filter(([key]) => key === 'language' || key.startsWith('pa:'))
        );
        const estimatedBytes = this._estimateAreaBytes(relevantItems);
        const perItem = Object.entries(relevantItems).map(([key, value]) => ({
            key,
            bytes: this._estimateItemBytes(key, value)
        }));

        return {
            bytes: estimatedBytes,
            quotaBytes: CONFIG.SYNC.QUOTA_BYTES,
            items: perItem.length,
            maxItems: CONFIG.SYNC.MAX_ITEMS,
            largestItemBytes: perItem.reduce((maximum, item) => Math.max(maximum, item.bytes), 0),
            perItem
        };
    },

    async getSyncStatus() {
        const result = await this._areaGet('local', CONFIG.STORAGE_KEYS.V2_SYNC_STATUS);
        return result[CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]
            || { pendingDeletes: [], pendingScalars: {}, lastError: null };
    },

    async _replaceCards(cards) {
        if (!Array.isArray(cards)) throw new Error('Cards must be an array');
        const normalizedCards = cards.map(card => this._normalizeCard(card));
        this._validateUniqueIds(normalizedCards, 'card');

        const nextById = new Map(normalizedCards.map(card => [card.id, card]));
        const localValues = {};
        const syncValues = {};
        const changedKeys = [];

        nextById.forEach((card, id) => {
            const current = this._cards.get(id);
            if (current && this._sameData(current.data, card)) return;
            const key = this._cardKey(id);
            localValues[key] = { data: card, pending: true };
            syncValues[key] = this._encodeCard(card);
            changedKeys.push(key);
        });

        const removedKeys = [...this._cards.keys()]
            .filter(id => !nextById.has(id))
            .map(id => this._cardKey(id));

        if (Object.keys(localValues).length > 0) await this._areaSet('local', localValues);
        if (removedKeys.length > 0) {
            await this._queuePendingDeletes(removedKeys);
            await this._areaRemove('local', removedKeys);
        }

        this._cards = new Map(normalizedCards.map(card => {
            const current = this._cards.get(card.id);
            const changed = !current || !this._sameData(current.data, card);
            return [card.id, { data: card, pending: changed ? true : current.pending }];
        }));

        let synced = true;
        try {
            await this._writeSyncChanges(syncValues, removedKeys);
            await this._markEntitiesSynced(changedKeys);
            await this._clearPendingDeletes(removedKeys);
        } catch (error) {
            synced = false;
            await this._recordSyncError(error);
        }

        mediaStorage.cleanupUnused(normalizedCards).catch(error => {
            console.warn('Unable to clean unused images:', error);
        });
        return { synced };
    },

    async _replaceWrappers(wrappers) {
        if (!Array.isArray(wrappers)) throw new Error('Wrappers must be an array');
        const normalizedWrappers = wrappers.map(wrapper => this._normalizeWrapper(wrapper));
        this._validateUniqueIds(normalizedWrappers, 'wrapper');

        const nextById = new Map(normalizedWrappers.map(wrapper => [wrapper.id, wrapper]));
        const localValues = {};
        const syncValues = {};
        const changedKeys = [];

        nextById.forEach((wrapper, id) => {
            const current = this._wrappers.get(id);
            if (current && this._sameData(current.data, wrapper)) return;
            const key = this._wrapperKey(id);
            localValues[key] = { data: wrapper, pending: true };
            syncValues[key] = this._encodeWrapper(wrapper);
            changedKeys.push(key);
        });

        const removedKeys = [...this._wrappers.keys()]
            .filter(id => !nextById.has(id))
            .map(id => this._wrapperKey(id));

        if (Object.keys(localValues).length > 0) await this._areaSet('local', localValues);
        if (removedKeys.length > 0) {
            await this._queuePendingDeletes(removedKeys);
            await this._areaRemove('local', removedKeys);
        }

        this._wrappers = new Map(normalizedWrappers.map(wrapper => {
            const current = this._wrappers.get(wrapper.id);
            const changed = !current || !this._sameData(current.data, wrapper);
            return [wrapper.id, { data: wrapper, pending: changed ? true : current.pending }];
        }));

        let synced = true;
        try {
            await this._writeSyncChanges(syncValues, removedKeys);
            await this._markEntitiesSynced(changedKeys);
            await this._clearPendingDeletes(removedKeys);
        } catch (error) {
            synced = false;
            await this._recordSyncError(error);
        }
        return { synced };
    },

    async _setWrapperStates(states) {
        this._wrapperStates = this._normalizeStates(states);
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_STATES]: this._wrapperStates });
        await this._queuePendingScalars({ [CONFIG.STORAGE_KEYS.V2_STATES]: this._wrapperStates });
        try {
            await this._writeSyncChanges({ [CONFIG.STORAGE_KEYS.V2_STATES]: this._wrapperStates }, []);
            await this._clearPendingScalars([CONFIG.STORAGE_KEYS.V2_STATES]);
            return { synced: true };
        } catch (error) {
            await this._recordSyncError(error);
            return { synced: false };
        }
    },

    async _setHighestDefaultNum(value) {
        this._highestDefaultNum = Number.isFinite(Number(value)) ? Number(value) : -1;
        await this._areaSet('local', {
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: this._highestDefaultNum
        });
        await this._queuePendingScalars({
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: this._highestDefaultNum
        });
        try {
            await this._writeSyncChanges({
                [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: this._highestDefaultNum
            }, []);
            await this._clearPendingScalars([CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]);
            return { synced: true };
        } catch (error) {
            await this._recordSyncError(error);
            return { synced: false };
        }
    },

    async _migrateLegacy(localItems, syncItems, legacyCards, legacyWrappers) {
        const migration = await mediaStorage.migrateLegacyPreviews(legacyCards);
        for (const record of migration.records) await mediaStorage.put(record);
        const requiredLocalMediaReady = await this._verifyRequiredLocalMedia(migration.cards);

        const result = await this.replaceAllData({
            cards: migration.cards,
            wrappers: legacyWrappers,
            wrapperStates: syncItems[CONFIG.STORAGE_KEYS.WRAPPER_STATES] || {},
            highestDefaultNum: localItems[CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM] ?? -1
        });

        if (requiredLocalMediaReady
            && result.synced
            && await this._verifySyncRoundTrip(migration.cards, legacyWrappers)) {
            await this._removeLegacyData();
        }
    },

    async _seedLegacyMedia(legacyCards) {
        try {
            const migration = await mediaStorage.migrateLegacyPreviews(legacyCards);
            for (const record of migration.records) {
                if (!await mediaStorage.get(record.id)) await mediaStorage.put(record);
            }
            return this._verifyRequiredLocalMedia(migration.cards);
        } catch (error) {
            // The active Sync metadata may still be usable, but v1 must stay
            // intact because one of these blobs can be the sole copy of a
            // user-selected local image.
            console.warn('Unable to seed one or more legacy previews:', error);
            return false;
        }
    },

    async _loadAndMergeV2(localItems, syncItems, { flushPending = true, removeLegacy = false } = {}) {
        if (!this._isCompleteSyncSnapshot(syncItems)) {
            throw new Error('Refusing to activate an incomplete Chrome Sync snapshot');
        }

        this._cards.clear();
        this._wrappers.clear();

        const localEntityKeys = Object.keys(localItems).filter(key => this._isEntityKey(key));
        const syncEntityKeys = new Set(Object.keys(syncItems).filter(key => this._isEntityKey(key)));
        const syncStatus = localItems[CONFIG.STORAGE_KEYS.V2_SYNC_STATUS] || {};
        const pendingDeleteSet = new Set(syncStatus.pendingDeletes || []);
        const pendingScalars = syncStatus.pendingScalars && typeof syncStatus.pendingScalars === 'object'
            ? syncStatus.pendingScalars
            : {};
        const localUpdates = {};
        const localRemovals = [];
        const pendingScalarsToClear = [];

        Object.entries(syncItems).forEach(([key, value]) => {
            if (pendingDeleteSet.has(key)) {
                localRemovals.push(key);
                return;
            }
            if (key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)) {
                const id = key.slice(CONFIG.STORAGE_KEYS.CARD_PREFIX.length);
                const localEntry = this._readLocalEntry(localItems[key]);
                if (localEntry && this._sameData(this._encodeCard(localEntry.data), value)) {
                    if (localEntry.pending) {
                        localEntry.pending = false;
                        localUpdates[key] = localEntry;
                    }
                    this._cards.set(id, localEntry);
                } else if (localEntry?.pending) {
                    const localEncoded = this._encodeCard(localEntry.data);
                    if (this._pendingValueWins(localEncoded, value)) {
                        this._cards.set(id, localEntry);
                    } else {
                        const card = this._decodeCard(id, value);
                        const entry = { data: card, pending: false };
                        this._cards.set(id, entry);
                        localUpdates[key] = entry;
                    }
                } else {
                    const card = this._decodeCard(id, value);
                    const entry = { data: card, pending: false };
                    this._cards.set(id, entry);
                    localUpdates[key] = entry;
                }
            } else if (key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX)) {
                const id = key.slice(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX.length);
                const localEntry = this._readLocalEntry(localItems[key]);
                if (localEntry && this._sameData(this._encodeWrapper(localEntry.data), value)) {
                    if (localEntry.pending) {
                        localEntry.pending = false;
                        localUpdates[key] = localEntry;
                    }
                    this._wrappers.set(id, localEntry);
                } else if (localEntry?.pending) {
                    const localEncoded = this._encodeWrapper(localEntry.data);
                    if (this._pendingValueWins(localEncoded, value)) {
                        this._wrappers.set(id, localEntry);
                    } else {
                        const wrapper = this._decodeWrapper(id, value);
                        const entry = { data: wrapper, pending: false };
                        this._wrappers.set(id, entry);
                        localUpdates[key] = entry;
                    }
                } else {
                    const wrapper = this._decodeWrapper(id, value);
                    const entry = { data: wrapper, pending: false };
                    this._wrappers.set(id, entry);
                    localUpdates[key] = entry;
                }
            }
        });

        localEntityKeys.forEach(key => {
            if (syncEntityKeys.has(key)) return;
            const localEntry = this._readLocalEntry(localItems[key]);
            if (localEntry?.pending) {
                if (key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)) {
                    this._cards.set(localEntry.data.id, localEntry);
                } else {
                    this._wrappers.set(localEntry.data.id, localEntry);
                }
            } else {
                localRemovals.push(key);
            }
        });

        const remoteStates = this._normalizeStates(syncItems[CONFIG.STORAGE_KEYS.V2_STATES] || {});
        const hasPendingStates = Object.prototype.hasOwnProperty.call(
            pendingScalars,
            CONFIG.STORAGE_KEYS.V2_STATES
        );
        if (hasPendingStates) {
            const localStates = this._normalizeStates(pendingScalars[CONFIG.STORAGE_KEYS.V2_STATES]);
            if (this._sameData(localStates, remoteStates)
                || !this._pendingValueWins(localStates, remoteStates)) {
                this._wrapperStates = remoteStates;
                pendingScalarsToClear.push(CONFIG.STORAGE_KEYS.V2_STATES);
            } else {
                this._wrapperStates = localStates;
            }
        } else {
            this._wrapperStates = remoteStates;
        }

        const remoteHighest = Number(syncItems[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM] ?? -1);
        const hasPendingHighest = Object.prototype.hasOwnProperty.call(
            pendingScalars,
            CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM
        );
        if (hasPendingHighest) {
            const localHighest = Number(pendingScalars[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]);
            if (localHighest === remoteHighest
                || !this._pendingValueWins(localHighest, remoteHighest)) {
                this._highestDefaultNum = remoteHighest;
                pendingScalarsToClear.push(CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM);
            } else {
                this._highestDefaultNum = localHighest;
            }
        } else {
            this._highestDefaultNum = remoteHighest;
        }
        if (Object.prototype.hasOwnProperty.call(pendingScalars, CONFIG.STORAGE_KEYS.V2_SCHEMA)) {
            pendingScalarsToClear.push(CONFIG.STORAGE_KEYS.V2_SCHEMA);
        }

        const scalarUpdates = {
            [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
            [CONFIG.STORAGE_KEYS.V2_COMMIT]: this._clone(syncItems[CONFIG.STORAGE_KEYS.V2_COMMIT]),
            [CONFIG.STORAGE_KEYS.V2_STATES]: this._wrapperStates,
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: this._highestDefaultNum
        };
        Object.entries(scalarUpdates).forEach(([key, value]) => {
            if (!this._sameData(localItems[key], value)) localUpdates[key] = value;
        });

        await this._areaSet('local', localUpdates);
        if (localRemovals.length > 0) await this._areaRemove('local', localRemovals);
        if (pendingScalarsToClear.length > 0) await this._clearPendingScalars(pendingScalarsToClear);
        if (flushPending) await this._flushPendingWrites();

        if (removeLegacy
            && await this._verifyRequiredLocalMedia([...this._cards.values()].map(entry => entry.data))
            && await this._verifySyncRoundTrip(
                [...this._cards.values()].map(entry => entry.data),
                [...this._wrappers.values()].map(entry => entry.data)
            )) {
            await this._removeLegacyData();
        }
    },

    async _loadLocalV2(localItems) {
        this._cards.clear();
        this._wrappers.clear();

        Object.entries(localItems).forEach(([key, value]) => {
            const entry = this._readLocalEntry(value);
            if (!entry) return;
            if (key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)) {
                this._cards.set(entry.data.id, entry);
            } else if (key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX)) {
                this._wrappers.set(entry.data.id, entry);
            }
        });
        this._wrapperStates = this._normalizeStates(localItems[CONFIG.STORAGE_KEYS.V2_STATES] || {});
        this._highestDefaultNum = Number(localItems[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM] ?? -1);
    },

    async _loadLegacyFallback(localItems, syncItems, legacyCards, legacyWrappers) {
        this._cards.clear();
        this._wrappers.clear();

        let cards = legacyCards;
        try {
            const migration = await mediaStorage.migrateLegacyPreviews(legacyCards);
            for (const record of migration.records) {
                if (!await mediaStorage.get(record.id)) await mediaStorage.put(record);
            }
            cards = migration.cards;
        } catch (error) {
            // Keep the untouched v1 source in chrome.storage.local. The UI can
            // still use URL images while a malformed embedded preview waits
            // for explicit recovery.
            console.warn('Using legacy metadata while waiting for a complete Sync snapshot:', error);
        }

        cards.map(card => this._normalizeCard(card)).forEach(card => {
            this._cards.set(card.id, { data: card, pending: false });
        });
        legacyWrappers.map(wrapper => this._normalizeWrapper(wrapper)).forEach(wrapper => {
            this._wrappers.set(wrapper.id, { data: wrapper, pending: false });
        });
        this._wrapperStates = this._normalizeStates(
            syncItems[CONFIG.STORAGE_KEYS.WRAPPER_STATES]
                ?? localItems[CONFIG.STORAGE_KEYS.V2_STATES]
                ?? {}
        );
        this._highestDefaultNum = Number(
            localItems[CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM]
                ?? localItems[CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]
                ?? -1
        );
    },

    async _ensureWritableSnapshot() {
        if (this._syncSnapshotReady) return;

        const localValues = {
            [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
            [CONFIG.STORAGE_KEYS.V2_STATES]: this._wrapperStates,
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: this._highestDefaultNum
        };
        this._cards.forEach((entry, id) => {
            entry.pending = true;
            localValues[this._cardKey(id)] = entry;
        });
        this._wrappers.forEach((entry, id) => {
            entry.pending = true;
            localValues[this._wrapperKey(id)] = entry;
        });

        await this._areaSet('local', localValues);
        await this._queuePendingScalars({
            [CONFIG.STORAGE_KEYS.V2_SCHEMA]: CONFIG.SCHEMA_VERSION,
            [CONFIG.STORAGE_KEYS.V2_STATES]: this._wrapperStates,
            [CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM]: this._highestDefaultNum
        });
        this._syncSnapshotReady = true;
        await this._flushPendingWrites();
    },

    async _flushPendingWrites() {
        const syncValues = {};
        const pendingKeys = [];

        this._cards.forEach((entry, id) => {
            if (!entry.pending) return;
            const key = this._cardKey(id);
            syncValues[key] = this._encodeCard(entry.data);
            pendingKeys.push(key);
        });
        this._wrappers.forEach((entry, id) => {
            if (!entry.pending) return;
            const key = this._wrapperKey(id);
            syncValues[key] = this._encodeWrapper(entry.data);
            pendingKeys.push(key);
        });

        const status = await this.getSyncStatus();
        const pendingDeletes = Array.isArray(status.pendingDeletes) ? status.pendingDeletes : [];
        const pendingScalars = status.pendingScalars && typeof status.pendingScalars === 'object'
            ? status.pendingScalars
            : {};
        Object.assign(syncValues, pendingScalars);

        // A clean v2 startup must not consume a Sync write. Only a real
        // pending entity, scalar or delete reaches chrome.storage.sync.
        if (Object.keys(syncValues).length === 0 && pendingDeletes.length === 0) return;

        try {
            await this._writeSyncChanges(syncValues, pendingDeletes);
            await this._markEntitiesSynced(pendingKeys);
            await this._clearPendingDeletes(pendingDeletes);
            await this._clearPendingScalars(Object.keys(pendingScalars));
            await this._clearSyncError();
            if (await this._verifyRequiredLocalMedia(
                [...this._cards.values()].map(entry => entry.data)
            ) && await this._verifySyncRoundTrip(
                [...this._cards.values()].map(entry => entry.data),
                [...this._wrappers.values()].map(entry => entry.data)
            )) {
                await this._removeLegacyData();
            }
        } catch (error) {
            await this._recordSyncError(error);
        }
    },

    async _markEntitiesSynced(keys) {
        if (keys.length === 0) return;
        const localValues = {};
        keys.forEach(key => {
            if (key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)) {
                const id = key.slice(CONFIG.STORAGE_KEYS.CARD_PREFIX.length);
                const entry = this._cards.get(id);
                if (entry) {
                    entry.pending = false;
                    localValues[key] = entry;
                }
            } else if (key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX)) {
                const id = key.slice(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX.length);
                const entry = this._wrappers.get(id);
                if (entry) {
                    entry.pending = false;
                    localValues[key] = entry;
                }
            }
        });
        if (Object.keys(localValues).length > 0) await this._areaSet('local', localValues);
    },

    async _verifySyncRoundTrip(cards, wrappers) {
        const syncItems = await this._areaGet('sync', null);
        if (!this._isCompleteSyncSnapshot(syncItems)) return false;

        const syncedCards = Object.keys(syncItems).filter(key => key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX));
        const syncedWrappers = Object.keys(syncItems).filter(key => key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX));
        if (syncedCards.length !== cards.length || syncedWrappers.length !== wrappers.length) return false;

        return cards.every(card => {
            const encoded = syncItems[this._cardKey(card.id)];
            return encoded && this._sameData(this._decodeCard(card.id, encoded), this._normalizeCard(card));
        }) && wrappers.every(wrapper => {
            const encoded = syncItems[this._wrapperKey(wrapper.id)];
            return encoded && this._sameData(this._decodeWrapper(wrapper.id, encoded), this._normalizeWrapper(wrapper));
        });
    },

    async _removeLegacyData() {
        await Promise.all([
            this._areaRemove('local', [
                CONFIG.STORAGE_KEYS.CARDS,
                CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM
            ]),
            this._areaRemove('sync', [
                CONFIG.STORAGE_KEYS.WRAPPERS,
                CONFIG.STORAGE_KEYS.WRAPPER_STATES,
                CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM
            ])
        ]);
    },

    _normalizeCard(input) {
        if (!input || typeof input !== 'object' || !String(input.id || '').trim()) {
            throw new Error('Every card needs a valid id');
        }

        const card = { ...input };
        const imageUrl = mediaStorage.normalizeUrl(card.backgroundImage);
        delete card.backgroundImageBase64;
        delete card._syncPending;

        card.id = String(card.id);
        card.name = card.name == null ? '' : String(card.name);
        card.link = card.link == null ? '' : String(card.link);
        card.size = card.size == null ? 'card-small' : String(card.size);
        card.wrapperId = card.wrapperId == null ? '' : String(card.wrapperId);
        card.order = Number.isFinite(Number(card.order)) ? Number(card.order) : 0;
        card.backgroundImageSize = card.backgroundImageSize == null ? '100%' : String(card.backgroundImageSize);
        card.backgroundColor = card.backgroundColor == null ? '#000000' : String(card.backgroundColor);
        card.backgroundPosition = card.backgroundPosition == null ? '50,50' : String(card.backgroundPosition);
        card.showName = card.showName !== false;

        if (card.imageKind === 'local' || imageUrl.startsWith('data:')) {
            card.imageKind = 'local';
            card.backgroundImage = '';
        } else if (imageUrl) {
            card.imageKind = 'url';
            card.backgroundImage = `url(${imageUrl})`;
        } else {
            card.imageKind = 'none';
            card.backgroundImage = '';
        }
        if (card.imageKind === 'local' && card.imageRevision) {
            card.imageRevision = String(card.imageRevision);
        } else {
            delete card.imageRevision;
        }

        return card;
    },

    _normalizeWrapper(input) {
        if (!input || typeof input !== 'object' || !String(input.id || '').trim()) {
            throw new Error('Every wrapper needs a valid id');
        }
        return {
            ...input,
            id: String(input.id),
            name: input.name == null ? '' : String(input.name),
            order: Number.isFinite(Number(input.order)) ? Number(input.order) : 0
        };
    },

    _normalizeStates(states) {
        if (!states || typeof states !== 'object' || Array.isArray(states)) return {};
        return Object.fromEntries(Object.entries(states).map(([id, expanded]) => [id, Boolean(expanded)]));
    },

    _encodeCard(card) {
        const knownKeys = new Set([
            'id', 'name', 'link', 'wrapperId', 'order', 'backgroundImage',
            'imageKind', 'size', 'backgroundImageSize', 'backgroundColor',
            'backgroundPosition', 'showName', 'imageRevision'
        ]);
        const extras = Object.fromEntries(Object.entries(card).filter(([key]) => !knownKeys.has(key)));
        const imageValue = card.imageKind === 'local'
            ? 1
            : (card.imageKind === 'url' ? mediaStorage.normalizeUrl(card.backgroundImage) : null);
        const sizeValue = card.size === 'card-small' ? null
            : card.size === 'card-wide' ? 1
                : card.size === 'card-big' ? 2 : card.size;
        const sizeMatch = card.backgroundImageSize.match(/^(-?\d+(?:\.\d+)?)%$/);
        const backgroundSize = card.backgroundImageSize === '100%'
            ? null
            : (sizeMatch ? Number(sizeMatch[1]) : card.backgroundImageSize);
        const value = [
            card.name,
            card.link,
            card.wrapperId,
            card.order,
            imageValue,
            sizeValue,
            backgroundSize,
            card.backgroundColor === '#000000' ? null : card.backgroundColor,
            card.backgroundPosition === '50,50' ? null : card.backgroundPosition,
            card.showName === false ? 0 : null,
            card.imageKind === 'local' && card.imageRevision ? card.imageRevision : null,
            Object.keys(extras).length > 0 ? extras : null
        ];
        while (value.length > 4 && value[value.length - 1] === null) value.pop();
        return value;
    },

    _decodeCard(id, value) {
        if (!Array.isArray(value) || value.length < 4) throw new Error(`Invalid synced card: ${id}`);
        const imageValue = value[4];
        const sizeValue = value[5];
        const backgroundSize = value[6];
        const extras = value[11] && typeof value[11] === 'object' ? value[11] : {};
        return this._normalizeCard({
            ...extras,
            id,
            name: value[0],
            link: value[1],
            wrapperId: value[2],
            order: value[3],
            backgroundImage: typeof imageValue === 'string' ? `url(${imageValue})` : '',
            imageKind: imageValue === 1 ? 'local' : (typeof imageValue === 'string' ? 'url' : 'none'),
            size: sizeValue === null || sizeValue === undefined ? 'card-small'
                : sizeValue === 1 ? 'card-wide' : sizeValue === 2 ? 'card-big' : sizeValue,
            backgroundImageSize: backgroundSize === null || backgroundSize === undefined
                ? '100%'
                : (typeof backgroundSize === 'number' ? `${backgroundSize}%` : backgroundSize),
            backgroundColor: value[7] ?? '#000000',
            backgroundPosition: value[8] ?? '50,50',
            showName: value[9] !== 0,
            imageRevision: typeof value[10] === 'string' ? value[10] : ''
        });
    },

    _encodeWrapper(wrapper) {
        const extras = Object.fromEntries(
            Object.entries(wrapper).filter(([key]) => !['id', 'name', 'order'].includes(key))
        );
        const value = [wrapper.name, wrapper.order, Object.keys(extras).length > 0 ? extras : null];
        while (value.length > 2 && value[value.length - 1] === null) value.pop();
        return value;
    },

    _decodeWrapper(id, value) {
        if (!Array.isArray(value) || value.length < 2) throw new Error(`Invalid synced wrapper: ${id}`);
        return this._normalizeWrapper({ ...(value[2] || {}), id, name: value[0], order: value[1] });
    },

    _readLocalEntry(value) {
        if (!value || typeof value !== 'object' || !value.data) return null;
        return { data: this._clone(value.data), pending: Boolean(value.pending) };
    },

    _registerSyncListener() {
        if (this._syncListenerRegistered || !chrome.storage?.onChanged) return;
        this._syncListenerRegistered = true;

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'sync') return;
            this._applySyncChanges(changes).catch(error => console.error('Unable to apply synced changes:', error));
        });
    },

    async _applySyncChanges(changes) {
        const relevant = Object.keys(changes).some(key => (
            key === CONFIG.STORAGE_KEYS.V2_SCHEMA
            || key === CONFIG.STORAGE_KEYS.V2_COMMIT
            || key === CONFIG.STORAGE_KEYS.V2_STATES
            || key === CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM
            || this._isEntityKey(key)
        ));
        if (!relevant) return;

        if (this._reconcileScheduled) {
            this._reconcileRequested = true;
            return;
        }

        this._reconcileScheduled = true;
        try {
            do {
                this._reconcileRequested = false;
                const [localItems, syncItems] = await Promise.all([
                    this._areaGet('local', null),
                    this._areaGet('sync', null)
                ]);

                // Entity keys are intentionally delivered before the commit
                // marker. Ignore every intermediate state; the commit event
                // schedules another pass once the complete snapshot exists.
                if (!this._isCompleteSyncSnapshot(syncItems)) continue;

                const before = this._stableSerialize({
                    cards: [...this._cards.values()].map(entry => entry.data),
                    wrappers: [...this._wrappers.values()].map(entry => entry.data),
                    states: this._wrapperStates,
                    highest: this._highestDefaultNum
                });
                const legacyCards = Array.isArray(localItems[CONFIG.STORAGE_KEYS.CARDS])
                    ? localItems[CONFIG.STORAGE_KEYS.CARDS]
                    : [];
                let legacyMediaReady = true;
                if (legacyCards.length > 0) legacyMediaReady = await this._seedLegacyMedia(legacyCards);

                this._syncSnapshotReady = true;
                await this._loadAndMergeV2(localItems, syncItems, {
                    flushPending: true,
                    removeLegacy: legacyMediaReady
                });

                const after = this._stableSerialize({
                    cards: [...this._cards.values()].map(entry => entry.data),
                    wrappers: [...this._wrappers.values()].map(entry => entry.data),
                    states: this._wrapperStates,
                    highest: this._highestDefaultNum
                });
                if (before !== after) {
                    window.dispatchEvent(new CustomEvent('portal-atlas-data-changed'));
                }
            } while (this._reconcileRequested);
        } finally {
            this._reconcileScheduled = false;
        }
    },

    _syncCommitPayload(items) {
        const payload = {};
        Object.keys(items)
            .filter(key => (
                key === CONFIG.STORAGE_KEYS.V2_SCHEMA
                || key === CONFIG.STORAGE_KEYS.V2_STATES
                || key === CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM
                || this._isEntityKey(key)
            ))
            .sort()
            .forEach(key => {
                payload[key] = items[key];
            });
        return payload;
    },

    _checksum(value) {
        const text = this._stableSerialize(value);
        let hash = 0x811c9dc5;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36);
    },

    _buildSyncCommit(items) {
        const keys = Object.keys(items);
        const cardCount = keys.filter(key => key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)).length;
        const wrapperCount = keys.filter(key => key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX)).length;
        const revision = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        return [cardCount, wrapperCount, this._checksum(this._syncCommitPayload(items)), revision];
    },

    _isCompleteSyncSnapshot(items) {
        if (!items || items[CONFIG.STORAGE_KEYS.V2_SCHEMA] !== CONFIG.SCHEMA_VERSION) return false;
        if (!Object.prototype.hasOwnProperty.call(items, CONFIG.STORAGE_KEYS.V2_STATES)
            || !Object.prototype.hasOwnProperty.call(items, CONFIG.STORAGE_KEYS.V2_HIGHEST_DEFAULT_NUM)) {
            return false;
        }

        const commit = items[CONFIG.STORAGE_KEYS.V2_COMMIT];
        if (!Array.isArray(commit) || commit.length < 3) return false;
        const keys = Object.keys(items);
        const cardCount = keys.filter(key => key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)).length;
        const wrapperCount = keys.filter(key => key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX)).length;
        return Number(commit[0]) === cardCount
            && Number(commit[1]) === wrapperCount
            && commit[2] === this._checksum(this._syncCommitPayload(items));
    },

    _pendingValueWins(localValue, remoteValue) {
        // Both devices make the same choice, so simultaneous offline edits
        // converge instead of repeatedly writing over one another.
        return this._stableSerialize(localValue) > this._stableSerialize(remoteValue);
    },

    async _verifyRequiredLocalMedia(cards) {
        for (const card of cards) {
            if (card.imageKind !== 'local') continue;
            const record = await mediaStorage.get(mediaStorage.localId(card.id));
            if (!record?.blob || !(record.blob instanceof Blob) || record.blob.size === 0) return false;
        }
        return true;
    },

    async _writeSyncChanges(values, keysToRemove) {
        const setValues = { ...(values || {}) };
        delete setValues[CONFIG.STORAGE_KEYS.V2_COMMIT];
        const removals = [...new Set((keysToRemove || []).filter(Boolean))];
        const current = await this._areaGet('sync', null);
        const projected = { ...current, ...setValues };
        removals.forEach(key => delete projected[key]);
        delete projected[CONFIG.STORAGE_KEYS.V2_COMMIT];
        projected[CONFIG.STORAGE_KEYS.V2_COMMIT] = this._buildSyncCommit(projected);
        this._assertSyncPayloadFits(projected);

        // Entity/scalar values are staged first and the checksum commit is
        // written separately at the end. Until then the previous commit no
        // longer validates, so another PC cannot activate a partial snapshot.
        const intermediate = { ...current, ...setValues };
        if (removals.length > 0 && this._estimateAreaBytes(intermediate) > CONFIG.SYNC.SAFE_TOTAL_BYTES) {
            await this._areaRemove('sync', removals);
            if (Object.keys(setValues).length > 0) await this._areaSet('sync', setValues);
        } else {
            if (Object.keys(setValues).length > 0) await this._areaSet('sync', setValues);
            if (removals.length > 0) await this._areaRemove('sync', removals);
        }
        await this._areaSet('sync', {
            [CONFIG.STORAGE_KEYS.V2_COMMIT]: projected[CONFIG.STORAGE_KEYS.V2_COMMIT]
        });
    },

    _assertSyncPayloadFits(items) {
        const entries = Object.entries(items);
        if (entries.length > CONFIG.SYNC.MAX_ITEMS) {
            throw new Error(`Chrome Sync item limit exceeded (${entries.length}/${CONFIG.SYNC.MAX_ITEMS})`);
        }

        for (const [key, value] of entries) {
            const bytes = this._estimateItemBytes(key, value);
            if (bytes > CONFIG.SYNC.QUOTA_BYTES_PER_ITEM) {
                throw new Error(`Chrome Sync item is too large: ${key} (${bytes} bytes)`);
            }
        }

        const totalBytes = this._estimateAreaBytes(items);
        if (totalBytes > CONFIG.SYNC.SAFE_TOTAL_BYTES) {
            throw new Error(`Chrome Sync quota would be exceeded (${totalBytes}/${CONFIG.SYNC.QUOTA_BYTES} bytes)`);
        }
    },

    _estimateItemBytes(key, value) {
        return new TextEncoder().encode(key).length + new TextEncoder().encode(JSON.stringify(value)).length;
    },

    _estimateAreaBytes(items) {
        return Object.entries(items).reduce(
            (total, [key, value]) => total + this._estimateItemBytes(key, value),
            0
        );
    },

    async _queuePendingDeletes(keys) {
        if (!keys.length) return;
        const status = await this.getSyncStatus();
        status.pendingDeletes = [...new Set([...(status.pendingDeletes || []), ...keys])];
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]: status });
    },

    async _clearPendingDeletes(keys) {
        if (!keys.length) return;
        const status = await this.getSyncStatus();
        const cleared = new Set(keys);
        status.pendingDeletes = (status.pendingDeletes || []).filter(key => !cleared.has(key));
        if (status.pendingDeletes.length === 0) status.lastError = null;
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]: status });
    },

    async _queuePendingScalars(values) {
        if (!values || Object.keys(values).length === 0) return;
        const status = await this.getSyncStatus();
        status.pendingScalars = {
            ...(status.pendingScalars && typeof status.pendingScalars === 'object'
                ? status.pendingScalars
                : {}),
            ...this._clone(values)
        };
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]: status });
    },

    async _clearPendingScalars(keys) {
        if (!keys.length) return;
        const status = await this.getSyncStatus();
        const pendingScalars = status.pendingScalars && typeof status.pendingScalars === 'object'
            ? { ...status.pendingScalars }
            : {};
        keys.forEach(key => delete pendingScalars[key]);
        status.pendingScalars = pendingScalars;
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]: status });
    },

    async _recordSyncError(error) {
        const status = await this.getSyncStatus();
        status.lastError = {
            message: error?.message || String(error),
            timestamp: Date.now()
        };
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]: status });
        console.warn('Portal Atlas saved locally but could not update Chrome Sync:', error);
    },

    async _clearSyncError() {
        const status = await this.getSyncStatus();
        if (!status.lastError) return;
        status.lastError = null;
        await this._areaSet('local', { [CONFIG.STORAGE_KEYS.V2_SYNC_STATUS]: status });
    },

    _cardKey(id) {
        return `${CONFIG.STORAGE_KEYS.CARD_PREFIX}${id}`;
    },

    _wrapperKey(id) {
        return `${CONFIG.STORAGE_KEYS.WRAPPER_PREFIX}${id}`;
    },

    _isEntityKey(key) {
        return key.startsWith(CONFIG.STORAGE_KEYS.CARD_PREFIX)
            || key.startsWith(CONFIG.STORAGE_KEYS.WRAPPER_PREFIX);
    },

    _validateUniqueIds(items, label) {
        const ids = new Set();
        items.forEach(item => {
            if (ids.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`);
            ids.add(item.id);
        });
    },

    _sameData(left, right) {
        return this._stableSerialize(left) === this._stableSerialize(right);
    },

    _stableSerialize(value) {
        if (Array.isArray(value)) {
            return `[${value.map(item => this._stableSerialize(item)).join(',')}]`;
        }
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map(key => (
                `${JSON.stringify(key)}:${this._stableSerialize(value[key])}`
            )).join(',')}}`;
        }
        return JSON.stringify(value);
    },

    _clone(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    },

    _areaGet(areaName, keys) {
        return new Promise((resolve, reject) => {
            chrome.storage[areaName].get(keys, result => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(result || {});
            });
        });
    },

    _areaSet(areaName, values) {
        if (!values || Object.keys(values).length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            chrome.storage[areaName].set(values, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve();
            });
        });
    },

    _areaRemove(areaName, keys) {
        const filteredKeys = [...new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))];
        if (filteredKeys.length === 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
            chrome.storage[areaName].remove(filteredKeys, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve();
            });
        });
    }
};
