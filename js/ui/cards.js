const cardImageLoader = {
    _observer: null,
    _queue: [],
    _active: 0,
    _generation: 0,
    _objectUrls: new Map(),
    _remotePromises: new Map(),
    _remoteBackgrounds: new WeakMap(),
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
        this._remoteBackgrounds = new WeakMap();
        this._stats = { observed: 0, cacheHits: 0, remoteRequests: 0, maxConcurrent: 0 };
    },

    release(element) {
        if (!element) return;
        element.__portalAtlasImageVersion = (element.__portalAtlasImageVersion || 0) + 1;
        this._observer?.unobserve(element);
        const objectUrl = this._objectUrls.get(element);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        this._objectUrls.delete(element);
        this._remoteBackgrounds.delete(element);
    },

    observe(element, card) {
        this._stats.observed += 1;
        const generation = this._generation;
        const imageVersion = (element.__portalAtlasImageVersion || 0) + 1;
        element.__portalAtlasImageVersion = imageVersion;
        this._remoteBackgrounds.delete(element);

        if (!('IntersectionObserver' in window)) {
            this._load(element, card, generation, imageVersion);
            return;
        }

        if (!this._observer) {
            const observerGeneration = this._generation;
            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting || !entry.target.isConnected) return;
                    observer.unobserve(entry.target);
                    const observedCard = entry.target.__portalAtlasCard;
                    this._load(entry.target, observedCard, observerGeneration,
                        entry.target.__portalAtlasImageVersion);
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

    async _load(element, card, generation, imageVersion) {
        if (!this._isCurrent(element, generation, imageVersion) || !card) return;

        const mediaId = mediaStorage.getIdForCard(card);
        const driveState = typeof driveSync !== 'undefined' ? driveSync.getState() : null;
        const driveAvailable = Boolean(driveState?.enabled && driveState.online);
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

        if (!cachedRecord && mediaId && driveAvailable) {
            cachedRecord = await driveSync.restoreCardImage(card);
            localRevisionMatches = card.imageKind !== 'local'
                || !card.imageRevision
                || cachedRecord?.revision === card.imageRevision;
        }

        if (cachedRecord?.blob && localRevisionMatches) {
            this._stats.cacheHits += 1;
            this._setBlobBackground(element,
                cachedRecord.displayBlob || cachedRecord.qualityBlob || cachedRecord.blob,
                generation, imageVersion);
        }

        if (card.imageKind === 'local') {
            if (!cachedRecord) {
                element.classList.add('card-image-missing');
                element.title = window.i18n.translate('local_image_missing');
            } else if (driveAvailable && !cachedRecord.qualityBlob && !cachedRecord.displayBlob) {
                const driveRecord = await driveSync.restoreCardImage(card);
                if (driveRecord?.displayBlob) {
                    this._setBlobBackground(element, driveRecord.displayBlob, generation, imageVersion);
                }
            }
            return;
        }

        const remoteUrl = mediaStorage.normalizeUrl(card.backgroundImage);
        if (!remoteUrl) return;
        // The cached derivative is only a fast/offline placeholder. Once the
        // source URL loads successfully, keep the original-resolution image
        // as the final background and never replace it with a smaller blob.
        this._preloadRemoteBackground(element, remoteUrl, generation, imageVersion);
        const lastCheckedAt = Number(cachedRecord?.lastCheckedAt || cachedRecord?.updatedAt) || 0;
        if (cachedRecord?.blob && Date.now() - lastCheckedAt < CONFIG.MEDIA.REMOTE_REVALIDATE_MS) {
            if (driveAvailable && !cachedRecord.qualityBlob && !cachedRecord.displayBlob) {
                const driveRecord = await driveSync.restoreCardImage(card);
                if (driveRecord?.displayBlob && !this._hasRemoteBackground(element, remoteUrl)) {
                    this._setBlobBackground(element, driveRecord.displayBlob, generation, imageVersion);
                }
            }
            return;
        }

        try {
            const record = await this._enqueueRemote(remoteUrl, driveAvailable);
            if (!this._hasRemoteBackground(element, remoteUrl)) {
                this._setBlobBackground(element, record.displayBlob || record.blob,
                    generation, imageVersion);
            }
        } catch (error) {
            // Keep the last valid cached copy and avoid hammering a dead or
            // temporarily unavailable source on every new tab.
            if (cachedRecord?.blob) {
                try {
                    await mediaStorage.put({ ...cachedRecord, lastCheckedAt: Date.now() });
                } catch (cacheError) {
                    console.warn('Unable to record remote image revalidation:', cacheError);
                }
            }
            if (driveAvailable) {
                const driveRecord = await driveSync.restoreCardImage(card);
                if (driveRecord?.displayBlob && !this._hasRemoteBackground(element, remoteUrl)) {
                    this._setBlobBackground(element, driveRecord.displayBlob, generation, imageVersion);
                    return;
                }
            }
            // Some hosts prevent a fetch/canvas conversion even though a CSS
            // background is displayable. Probe the original URL, but keep the
            // existing Blob preview until the browser confirms it has loaded.
            console.warn('Unable to cache remote image:', remoteUrl, error);
        }
    },

    _enqueueRemote(url, includeQuality) {
        const id = `${mediaStorage.remoteId(url)}:${includeQuality ? 'quality' : 'preview'}`;
        if (this._remotePromises.has(id)) return this._remotePromises.get(id);

        const promise = new Promise((resolve, reject) => {
            this._queue.push({ url, includeQuality, resolve, reject });
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

            mediaStorage.cacheRemoteImage(task.url, null, { includeQuality: task.includeQuality })
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

    _isCurrent(element, generation, imageVersion) {
        return Boolean(element)
            && generation === this._generation
            && element.isConnected
            && element.__portalAtlasImageVersion === imageVersion;
    },

    _hasRemoteBackground(element, remoteUrl) {
        return this._remoteBackgrounds.get(element) === remoteUrl;
    },

    _setBlobBackground(element, blob, generation, imageVersion) {
        if (!this._isCurrent(element, generation, imageVersion)) return;
        const previousUrl = this._objectUrls.get(element);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        const objectUrl = URL.createObjectURL(blob);
        this._objectUrls.set(element, objectUrl);
        this._remoteBackgrounds.delete(element);
        element.style.backgroundImage = `url(${JSON.stringify(objectUrl)})`;
        element.classList.remove('card-image-missing');
        if (element.title === window.i18n.translate('local_image_missing')) element.removeAttribute('title');
    },

    _setRemoteBackground(element, remoteUrl, generation, imageVersion) {
        if (!this._isCurrent(element, generation, imageVersion)) return;
        const previousUrl = this._objectUrls.get(element);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        this._objectUrls.delete(element);
        this._remoteBackgrounds.set(element, remoteUrl);
        element.style.backgroundImage = `url(${JSON.stringify(remoteUrl)})`;
    },

    _preloadRemoteBackground(element, remoteUrl, generation, imageVersion) {
        if (!this._isCurrent(element, generation, imageVersion)) return;
        const probe = new Image();
        probe.decoding = 'async';
        probe.onload = () => {
            this._setRemoteBackground(element, remoteUrl, generation, imageVersion);
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

function getCardImageSignature(cardData) {
    const imageKind = cardData.imageKind
        || (mediaStorage.normalizeUrl(cardData.backgroundImage) ? 'url' : 'none');
    if (imageKind === 'local') return `local:${cardData.id}:${cardData.imageRevision || 'legacy'}`;
    if (imageKind === 'url') return `url:${mediaStorage.normalizeUrl(cardData.backgroundImage)}`;
    return 'none';
}

function updateCardElement(anchor, cardData, forceImage = false) {
    const previousSignature = anchor.__portalAtlasImageSignature;
    const nextSignature = getCardImageSignature(cardData);

    anchor.className = `card ${cardData.size}`;
    anchor.id = cardData.id || anchor.id || generateUUID();
    anchor.href = cardData.link;
    anchor.textContent = cardData.showName !== false ? cardData.name : ' ';
    anchor.style.backgroundSize = cardData.backgroundImageSize;
    anchor.style.backgroundColor = cardData.backgroundColor;

    const [x, y] = (cardData.backgroundPosition || '50,50').split(',');
    anchor.style.backgroundPosition = `${x}% ${y}%`;
    anchor.__portalAtlasCard = cardData;

    if (previousSignature === undefined || forceImage || previousSignature !== nextSignature) {
        if (previousSignature !== undefined) cardImageLoader.release(anchor);
        anchor.__portalAtlasImageSignature = nextSignature;
        anchor.style.backgroundImage = 'none';
        anchor.classList.remove('card-image-missing');
        anchor.removeAttribute('title');
        if (nextSignature !== 'none') cardImageLoader.observe(anchor, cardData);
    }

    return anchor;
}

function createCard(cardData, forceImage = false) {
    const anchor = document.createElement('a');
    anchor.addEventListener('contextmenu', async event => {
        event.preventDefault();
        await openEditPopup(anchor.__portalAtlasCard);
    });
    return updateCardElement(anchor, cardData, forceImage);
}

function placeElementsInOrder(container, elements) {
    let cursor = container.firstElementChild;
    elements.forEach(element => {
        if (element === cursor) {
            cursor = cursor.nextElementSibling;
            return;
        }
        container.insertBefore(element, cursor);
    });
}

async function renderCards({ forceImageIds = new Set() } = {}) {
    const wrappers = document.querySelectorAll('.wrapper');
    const cardsData = await dataManager.getAllCards();
    const cardsByWrapper = new Map();
    const existingCards = new Map(
        [...document.querySelectorAll('.wrapper .card')].map(element => [element.id, element])
    );
    const renderedIds = new Set();

    cardsData.forEach(card => {
        if (!cardsByWrapper.has(card.wrapperId)) cardsByWrapper.set(card.wrapperId, []);
        cardsByWrapper.get(card.wrapperId).push(card);
    });

    wrappers.forEach(wrapper => {
        const container = wrapper.querySelector('.container');
        if (!container) return;

        const cards = cardsByWrapper.get(wrapper.id) || [];
        cards.sort((left, right) => (left.order || 0) - (right.order || 0));
        const elements = cards.map(card => {
            renderedIds.add(card.id);
            const existing = existingCards.get(card.id);
            return existing
                ? updateCardElement(existing, card, forceImageIds.has(card.id))
                : createCard(card);
        });
        placeElementsInOrder(container, elements);
    });

    existingCards.forEach((element, id) => {
        if (renderedIds.has(id)) return;
        cardImageLoader.release(element);
        element.remove();
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
    updateCardPreviewDimensions(preview, cardSize);
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
    const [safeX, safeY] = parseImagePosition(`${x},${y}`);
    imageInput.dataset.position = `${safeX},${safeY}`;
    preview.style.backgroundPosition = `${safeX}% ${safeY}%`;

    const imageSource = localPreviewUrl || backgroundImage.trim();
    updateCardPreviewImageMetrics(preview, imageSource);
}

function clearCardPreviewDimensions() {
    const preview = document.getElementById('card-preview');
    if (!preview) return;
    delete preview.dataset.geometryKey;
    delete preview.dataset.sourceAspectRatio;
}

function updateCardPreviewDimensions(preview, cardSize) {
    const defaultRatios = {
        'card-small': 1,
        'card-wide': 2,
        'card-big': 1
    };
    const maxDimensions = cardSize === 'card-small'
        ? { width: 120, height: 120 }
        : { width: 250, height: 250 };
    const ratio = measureCardPreviewAspectRatio(preview, cardSize)
        || defaultRatios[cardSize]
        || 1;

    if (ratio >= 1) {
        preview.style.width = `${maxDimensions.width}px`;
        preview.style.height = `${Math.max(1, Math.round(maxDimensions.width / ratio))}px`;
    } else {
        preview.style.width = `${Math.max(1, Math.round(maxDimensions.height * ratio))}px`;
        preview.style.height = `${maxDimensions.height}px`;
    }
}

function measureCardPreviewAspectRatio(preview, cardSize) {
    const cardId = document.getElementById('card-id')?.value || '';
    const wrapperId = document.getElementById('card-wrapper')?.value || '';
    const targetContainer = document.getElementById(wrapperId)?.querySelector('.container');
    if (!targetContainer) return 0;

    const geometryKey = [
        cardId,
        wrapperId,
        cardSize,
        targetContainer.clientWidth,
        targetContainer.childElementCount
    ].join(':');
    const cachedRatio = Number.parseFloat(preview.dataset.sourceAspectRatio);
    if (preview.dataset.geometryKey === geometryKey
        && Number.isFinite(cachedRatio)
        && cachedRatio > 0) {
        return cachedRatio;
    }

    const existingCard = cardId ? document.getElementById(cardId) : null;
    const canMeasureExisting = existingCard?.closest('.container') === targetContainer;
    const measuredCard = canMeasureExisting ? existingCard : document.createElement('div');
    const originalClassName = measuredCard.className;
    let appendedProbe = false;

    try {
        measuredCard.className = `card ${cardSize}`;
        if (!canMeasureExisting) {
            measuredCard.style.visibility = 'hidden';
            measuredCard.style.pointerEvents = 'none';
            targetContainer.appendChild(measuredCard);
            appendedProbe = true;
        }

        const width = measuredCard.offsetWidth;
        const height = measuredCard.offsetHeight;
        if (width <= 0 || height <= 0) return 0;

        const ratio = width / height;
        preview.dataset.geometryKey = geometryKey;
        preview.dataset.sourceAspectRatio = String(ratio);
        return ratio;
    } finally {
        if (appendedProbe) measuredCard.remove();
        else measuredCard.className = originalClassName;
    }
}

function clampImagePosition(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 50;
    return Math.min(100, Math.max(0, numericValue));
}

function parseImagePosition(position) {
    const [rawX = 50, rawY = 50] = String(position || '50,50').split(',');
    return [clampImagePosition(rawX), clampImagePosition(rawY)];
}

function updateCardPreviewImageMetrics(preview, imageSource) {
    const source = String(imageSource || '').trim();
    if (preview.__portalAtlasImageSource === source) {
        updateImagePositionButtonsState();
        return;
    }

    preview.__portalAtlasImageSource = source;
    preview.__portalAtlasImageRatio = 0;
    const loadVersion = (preview.__portalAtlasImageLoadVersion || 0) + 1;
    preview.__portalAtlasImageLoadVersion = loadVersion;

    if (!source) {
        updateImagePositionButtonsState();
        return;
    }

    const image = new Image();
    image.onload = () => {
        if (preview.__portalAtlasImageLoadVersion !== loadVersion) return;
        preview.__portalAtlasImageRatio = image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : 0;
        updateImagePositionButtonsState();
    };
    image.onerror = () => {
        if (preview.__portalAtlasImageLoadVersion !== loadVersion) return;
        preview.__portalAtlasImageRatio = 0;
        updateImagePositionButtonsState();
    };
    image.src = source;
    updateImagePositionButtonsState();
}

function getCardPreviewImageGeometry() {
    const preview = document.getElementById('card-preview');
    const backgroundSizeInput = document.getElementById('card-background-size');
    const imageRatio = Number(preview?.__portalAtlasImageRatio) || 0;
    const backgroundSize = Number.parseFloat(backgroundSizeInput?.value);
    const containerWidth = preview?.clientWidth || 0;
    const containerHeight = preview?.clientHeight || 0;

    if (imageRatio <= 0 || backgroundSize <= 0 || containerWidth <= 0 || containerHeight <= 0) {
        return null;
    }

    const imageWidth = containerWidth * backgroundSize / 100;
    const imageHeight = imageWidth / imageRatio;
    return {
        horizontalTravel: containerWidth - imageWidth,
        verticalTravel: containerHeight - imageHeight
    };
}

function getImagePositionDelta(direction, geometry, step = 5) {
    if (!geometry) return 0;
    const horizontal = direction === 'left' || direction === 'right';
    const travel = horizontal ? geometry.horizontalTravel : geometry.verticalTravel;
    if (!Number.isFinite(travel) || Math.abs(travel) < 0.5) return 0;

    const desiredPixelDirection = direction === 'right' || direction === 'down' ? 1 : -1;
    return Math.sign(travel) * desiredPixelDirection * step;
}

function updateImagePositionButtonsState() {
    const imageInput = document.getElementById('card-background-image');
    if (!imageInput) return;

    const [x, y] = parseImagePosition(imageInput.dataset.position);
    const geometry = getCardPreviewImageGeometry();
    document.querySelectorAll('.btn-image-position').forEach(button => {
        const direction = button.dataset.direction;
        const currentPosition = direction === 'left' || direction === 'right' ? x : y;
        const delta = getImagePositionDelta(direction, geometry);
        button.disabled = delta === 0
            || clampImagePosition(currentPosition + delta) === currentPosition;
    });
}

function adjustImagePosition(direction) {
    const imageInput = document.getElementById('card-background-image');
    const positionDisplay = document.querySelector('.position-values');
    if (!imageInput || !positionDisplay) return;

    let [x, y] = parseImagePosition(imageInput.dataset.position);
    const delta = getImagePositionDelta(direction, getCardPreviewImageGeometry());
    if (delta === 0) return;

    switch (direction) {
        case 'up':
        case 'down':
            y = clampImagePosition(y + delta);
            break;
        case 'right':
        case 'left':
            x = clampImagePosition(x + delta);
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
