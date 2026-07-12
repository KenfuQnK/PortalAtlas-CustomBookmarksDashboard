const cardImageLoader = {
    _observer: null,
    _queue: [],
    _active: 0,
    _generation: 0,
    _objectUrls: new Map(),
    _remotePromises: new Map(),
    _stats: { observed: 0, cacheHits: 0, remoteRequests: 0, maxConcurrent: 0 },

    reset() {
        this._generation += 1;
        this._observer?.disconnect();
        this._observer = null;
        // Let already queued requests finish populating the shared cache.
        // Dropping them here would leave their deduplication promises pending
        // forever when a card edit triggers a rerender.
        this._objectUrls.forEach(url => URL.revokeObjectURL(url));
        this._objectUrls.clear();
        this._stats = { observed: 0, cacheHits: 0, remoteRequests: 0, maxConcurrent: 0 };
    },

    observe(element, card) {
        this._stats.observed += 1;
        const generation = this._generation;

        if (!('IntersectionObserver' in window)) {
            this._load(element, card, generation);
            return;
        }

        if (!this._observer) {
            const observerGeneration = this._generation;
            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting || !entry.target.isConnected) return;
                    observer.unobserve(entry.target);
                    const observedCard = entry.target.__portalAtlasCard;
                    this._load(entry.target, observedCard, observerGeneration);
                });
            }, {
                root: document.getElementById('main-container'),
                rootMargin: CONFIG.MEDIA.LAZY_ROOT_MARGIN,
                threshold: 0.01
            });
            this._observer = observer;
        }

        element.__portalAtlasCard = card;
        this._observer.observe(element);
    },

    async _load(element, card, generation) {
        if (!element || !card || generation !== this._generation) return;

        const mediaId = mediaStorage.getIdForCard(card);
        let cachedRecord = null;
        if (mediaId) {
            try {
                cachedRecord = await mediaStorage.get(mediaId);
            } catch (error) {
                console.warn('Unable to read cached card image:', error);
            }
        }

        let localRevisionMatches = card.imageKind !== 'local'
            || !card.imageRevision
            || cachedRecord?.revision === card.imageRevision;
        if (!localRevisionMatches) cachedRecord = null;

        if (!cachedRecord && mediaId && typeof driveSync !== 'undefined') {
            cachedRecord = await driveSync.restoreCardImage(card);
            localRevisionMatches = card.imageKind !== 'local'
                || !card.imageRevision
                || cachedRecord?.revision === card.imageRevision;
        }

        if (cachedRecord?.blob && localRevisionMatches) {
            this._stats.cacheHits += 1;
            this._setBlobBackground(element, cachedRecord.qualityBlob || cachedRecord.blob, generation);
        }

        if (card.imageKind === 'local') {
            if (!cachedRecord) {
                element.classList.add('card-image-missing');
                element.title = window.i18n.translate('local_image_missing');
            }
            return;
        }

        const remoteUrl = mediaStorage.normalizeUrl(card.backgroundImage);
        if (!remoteUrl) return;

        try {
            const record = await this._enqueueRemote(remoteUrl);
            if (generation === this._generation && element.isConnected) {
                this._setBlobBackground(element, record.displayBlob || record.blob, generation);
            }
        } catch (error) {
            // Some hosts prevent a fetch/canvas conversion even though a CSS
            // background is displayable. Probe the original URL, but keep the
            // existing Blob preview until the browser confirms it has loaded.
            this._preloadRemoteBackground(element, remoteUrl, generation);
            console.warn('Unable to cache remote image:', remoteUrl, error);
        }
    },

    _enqueueRemote(url) {
        const id = mediaStorage.remoteId(url);
        if (this._remotePromises.has(id)) return this._remotePromises.get(id);

        const promise = new Promise((resolve, reject) => {
            this._queue.push({ url, resolve, reject });
            this._drainQueue();
        }).finally(() => {
            this._remotePromises.delete(id);
        });
        this._remotePromises.set(id, promise);
        return promise;
    },

    _drainQueue() {
        while (this._active < CONFIG.MEDIA.LOAD_CONCURRENCY && this._queue.length > 0) {
            const task = this._queue.shift();
            this._active += 1;
            this._stats.remoteRequests += 1;
            this._stats.maxConcurrent = Math.max(this._stats.maxConcurrent, this._active);

            mediaStorage.cacheRemoteImage(task.url)
                .then(record => {
                    if (record.contentChanged && typeof driveSync !== 'undefined') {
                        driveSync.notifyLocalAssetChanged();
                    }
                    task.resolve(record);
                }, task.reject)
                .finally(() => {
                    this._active -= 1;
                    this._drainQueue();
                });
        }
    },

    _setBlobBackground(element, blob, generation) {
        if (generation !== this._generation || !element.isConnected) return;
        const previousUrl = this._objectUrls.get(element);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const objectUrl = URL.createObjectURL(blob);
        this._objectUrls.set(element, objectUrl);
        element.style.backgroundImage = `url(${JSON.stringify(objectUrl)})`;
        element.classList.remove('card-image-missing');
        if (element.title === window.i18n.translate('local_image_missing')) element.removeAttribute('title');
    },

    _setRemoteBackground(element, remoteUrl, generation) {
        if (generation !== this._generation || !element.isConnected) return;
        const previousUrl = this._objectUrls.get(element);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        this._objectUrls.delete(element);
        element.style.backgroundImage = `url(${JSON.stringify(remoteUrl)})`;
    },

    _preloadRemoteBackground(element, remoteUrl, generation) {
        if (generation !== this._generation || !element.isConnected) return;
        const probe = new Image();
        probe.decoding = 'async';
        probe.onload = () => {
            this._setRemoteBackground(element, remoteUrl, generation);
        };
        probe.onerror = () => {
            // Intentionally do nothing: the last valid Blob remains visible.
        };
        probe.src = remoteUrl;
    },

    getStats() {
        return { ...this._stats, active: this._active, queued: this._queue.length };
    }
};

function createCard(cardData) {
    const anchor = document.createElement('a');
    anchor.className = `card ${cardData.size}`;
    anchor.id = cardData.id || generateUUID();
    anchor.href = cardData.link;
    anchor.textContent = cardData.showName !== false ? cardData.name : ' ';
    anchor.style.backgroundSize = cardData.backgroundImageSize;
    anchor.style.backgroundColor = cardData.backgroundColor;

    const [x, y] = (cardData.backgroundPosition || '50,50').split(',');
    anchor.style.backgroundPosition = `${x}% ${y}%`;

    anchor.addEventListener('contextmenu', async event => {
        event.preventDefault();
        await openEditPopup(cardData);
    });

    cardImageLoader.observe(anchor, cardData);
    return anchor;
}

async function renderCards() {
    cardImageLoader.reset();
    const wrappers = document.querySelectorAll('.wrapper');
    const cardsData = await dataManager.getAllCards();
    const cardsByWrapper = new Map();

    cardsData.forEach(card => {
        if (!cardsByWrapper.has(card.wrapperId)) cardsByWrapper.set(card.wrapperId, []);
        cardsByWrapper.get(card.wrapperId).push(card);
    });

    wrappers.forEach(wrapper => {
        const container = wrapper.querySelector('.container');
        if (!container) return;

        const fragment = document.createDocumentFragment();
        const cards = cardsByWrapper.get(wrapper.id) || [];
        cards.sort((left, right) => (left.order || 0) - (right.order || 0));
        cards.forEach(card => fragment.appendChild(createCard(card)));
        container.replaceChildren(fragment);
    });
}

async function updateCardOrder() {
    const wrappers = document.querySelectorAll('.wrapper');
    const cards = await dataManager.getAllCards();
    const cardsById = new Map(cards.map(card => [card.id, card]));

    wrappers.forEach(wrapper => {
        wrapper.querySelectorAll('.card').forEach((cardElement, index) => {
            const card = cardsById.get(cardElement.id);
            if (!card) return;
            card.order = index;
            card.wrapperId = wrapper.id;
        });
    });

    await storage.set(CONFIG.STORAGE_KEYS.CARDS, [...cardsById.values()]);
}

function updateCardPreview() {
    const preview = document.getElementById('card-preview');
    if (!preview) return;

    const name = document.getElementById('card-name').value;
    const backgroundImage = document.getElementById('card-background-image').value;
    const backgroundSize = document.getElementById('card-background-size').value;
    const backgroundColor = document.getElementById('card-background-color').value;
    const cardSize = document.getElementById('card-size').value;
    const showName = document.querySelector('.btn-visibility').classList.contains('active');
    const localPreviewUrl = typeof getCardFormPreviewUrl === 'function' ? getCardFormPreviewUrl() : '';

    preview.className = `card ${cardSize}`;
    preview.textContent = showName ? (name || window.i18n.translate('preview')) : '';
    preview.style.backgroundSize = `${backgroundSize}%`;
    preview.style.backgroundColor = backgroundColor;

    if (localPreviewUrl) {
        preview.style.backgroundImage = `url(${JSON.stringify(localPreviewUrl)})`;
    } else if (backgroundImage) {
        preview.style.backgroundImage = `url(${JSON.stringify(backgroundImage)})`;
    } else {
        preview.style.backgroundImage = 'none';
    }

    const imageInput = document.getElementById('card-background-image');
    const [x, y] = (imageInput.dataset.position || '50,50').split(',').map(Number);
    preview.style.backgroundPosition = `${x}% ${y}%`;
}

function adjustImagePosition(direction) {
    const imageInput = document.getElementById('card-background-image');
    const positionDisplay = document.querySelector('.position-values');
    const backgroundSize = parseInt(document.getElementById('card-background-size').value, 10);
    if (!imageInput || !positionDisplay) return;

    let [x, y] = imageInput.dataset.position
        ? imageInput.dataset.position.split(',').map(Number)
        : [50, 50];
    const step = 5;
    const inverted = backgroundSize > 100;

    switch (direction) {
        case 'up':
            y = Math.max(0, y - (inverted ? -step : step));
            break;
        case 'right':
            x = Math.min(100, x + (inverted ? -step : step));
            break;
        case 'down':
            y = Math.min(100, y + (inverted ? -step : step));
            break;
        case 'left':
            x = Math.max(0, x + (inverted ? step : -step));
            break;
    }

    imageInput.dataset.position = `${x},${y}`;
    const [horizontalDiv, verticalDiv] = positionDisplay.children;
    if (horizontalDiv && verticalDiv) {
        horizontalDiv.textContent = `${window.i18n.translate('horizontal')}: ${x}%`;
        verticalDiv.textContent = `${window.i18n.translate('vertical')}: ${y}%`;
    }
    updateCardPreview();
}

function setupImagePositionButtons() {
    const container = document.querySelector('.image-position-buttons');
    if (!container || container.dataset.listenerReady === 'true') return;
    container.dataset.listenerReady = 'true';
    container.addEventListener('click', handleImagePositionButtons);
}

function handleImagePositionButtons(event) {
    const button = event.target.closest('.btn-image-position');
    const direction = button?.getAttribute('data-direction');
    if (direction) adjustImagePosition(direction);
}

window.addEventListener('beforeunload', () => cardImageLoader.reset());
