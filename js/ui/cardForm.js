const cardFormImageState = {
    imageKind: 'none',
    pendingRecord: null,
    previewUrl: '',
    originalCardId: '',
    originalImageRevision: '',
    generation: 0,
    processing: false,

    clearPreviewUrl() {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = '';
    },

    reset() {
        this.generation += 1;
        this.clearPreviewUrl();
        this.imageKind = 'none';
        this.pendingRecord = null;
        this.originalCardId = '';
        this.originalImageRevision = '';
        this.processing = false;
    },

    setPreviewBlob(blob) {
        this.clearPreviewUrl();
        this.previewUrl = URL.createObjectURL(blob);
    }
};

function getCardFormPreviewUrl() {
    return cardFormImageState.previewUrl;
}

function setupPopupForm() {
    const addCardBtn = document.getElementById('add-card-btn');
    const deleteCardBtn = document.getElementById('delete-card-btn');
    const popupForm = document.getElementById('popup-form-card');
    const closePopup = document.getElementById('close-popup-card');
    const form = document.getElementById('new-card-form');
    const imageInput = document.getElementById('card-background-image');
    const imageFileInput = document.getElementById('card-background-file');
    const selectImageButton = document.getElementById('select-image-file-btn');
    const resetImageButton = document.getElementById('reset-image-btn');
    const linkInput = document.getElementById('card-link');
    const resetLinkButton = document.getElementById('reset-link-btn');
    const sizeInput = document.getElementById('card-background-size');
    const colorInput = document.getElementById('card-background-color');

    addCardBtn.addEventListener('click', async () => {
        await resetCardForm();
        const formGeneration = cardFormImageState.generation;
        await loadWrapperSelect();
        if (formGeneration !== cardFormImageState.generation) return;
        popupForm.style.display = 'block';
    });

    deleteCardBtn.addEventListener('click', async () => {
        if (await deleteCard()) closeCardPopup();
    });

    closePopup.addEventListener('click', closeCardPopup);
    window.addEventListener('click', event => {
        if (event.target === popupForm) closeCardPopup();
    });

    form.addEventListener('submit', handleCardFormSubmit);
    document.getElementById('card-name').addEventListener('input', updateCardPreview);
    colorInput.addEventListener('input', updateCardPreview);
    sizeInput.addEventListener('input', () => {
        document.getElementById('card-background-size-value').textContent = `${sizeInput.value}%`;
        updateCardPreview();
    });

    imageInput.addEventListener('input', () => {
        cardFormImageState.generation += 1;
        cardFormImageState.processing = false;
        cardFormImageState.pendingRecord = null;
        cardFormImageState.imageKind = imageInput.value.trim() ? 'url' : 'none';
        cardFormImageState.clearPreviewUrl();
        setCardFormBusy(false);
        setLocalImageStatus('');
        updateCardPreview();
    });

    selectImageButton.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', handleLocalImageSelection);
    resetImageButton.addEventListener('click', resetSelectedImage);

    resetLinkButton.addEventListener('click', () => {
        linkInput.value = '';
        delete linkInput.dataset.fullUrl;
        updateCardPreview();
    });
    linkInput.addEventListener('input', () => delete linkInput.dataset.fullUrl);

    document.querySelectorAll('.btn-card-size').forEach(button => {
        button.addEventListener('click', () => setupSizeButtons(button.dataset.size));
    });
    document.querySelector('.btn-visibility').addEventListener('click', handleVisibilityToggle);
    setupImagePositionButtons();
}

function closeCardPopup() {
    document.getElementById('popup-form-card').style.display = 'none';
    cardFormImageState.reset();
    setCardFormBusy(false);
}

async function handleLocalImageSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const generation = ++cardFormImageState.generation;
    cardFormImageState.processing = true;
    setCardFormBusy(true);

    try {
        const optimized = await mediaStorage.optimizeBlob(file);
        const revision = await mediaStorage.fingerprintBlob(optimized.blob);
        if (generation !== cardFormImageState.generation) return;
        cardFormImageState.pendingRecord = { ...optimized, revision };
        cardFormImageState.imageKind = 'local';
        cardFormImageState.setPreviewBlob(optimized.blob);
        document.getElementById('card-background-image').value = '';
        setLocalImageStatus(window.i18n.translate('local_image_selected'));
        updateCardPreview();
    } catch (error) {
        if (generation !== cardFormImageState.generation) return;
        console.error('Unable to prepare local image:', error);
        alert(window.i18n.translate('invalid_image'));
    } finally {
        event.target.value = '';
        if (generation === cardFormImageState.generation) {
            cardFormImageState.processing = false;
            setCardFormBusy(false);
        }
    }
}

function resetSelectedImage() {
    cardFormImageState.generation += 1;
    cardFormImageState.processing = false;
    cardFormImageState.pendingRecord = null;
    cardFormImageState.imageKind = 'none';
    cardFormImageState.clearPreviewUrl();
    const imageInput = document.getElementById('card-background-image');
    imageInput.value = '';
    imageInput.dataset.position = '50,50';
    document.getElementById('card-background-size').value = 100;
    document.getElementById('card-background-size-value').textContent = '100%';
    setPositionDisplay('50,50');
    setLocalImageStatus('');
    setCardFormBusy(false);
    updateCardPreview();
}

async function openEditPopup(cardData) {
    cardFormImageState.reset();
    const formGeneration = cardFormImageState.generation;
    await loadWrapperSelect();
    if (formGeneration !== cardFormImageState.generation) return;
    const popupForm = document.getElementById('popup-form-card');
    popupForm.style.display = 'block';
    document.getElementById('delete-card-btn').style.display = 'block';
    document.getElementById('form-main-buttons').classList.remove('single-button');

    cardFormImageState.originalCardId = cardData.id;
    cardFormImageState.originalImageRevision = cardData.imageRevision || '';
    cardFormImageState.imageKind = cardData.imageKind
        || (mediaStorage.normalizeUrl(cardData.backgroundImage) ? 'url' : 'none');

    const safeData = {
        id: CONFIG.DEFAULT_VALUES.ID,
        name: CONFIG.DEFAULT_VALUES.NAME,
        link: CONFIG.DEFAULT_VALUES.LINK,
        size: CONFIG.DEFAULT_VALUES.SIZE,
        backgroundImage: CONFIG.DEFAULT_VALUES.BACKGROUND_IMAGE,
        backgroundImageSize: CONFIG.DEFAULT_VALUES.BACKGROUND_SIZE,
        backgroundColor: CONFIG.DEFAULT_VALUES.BACKGROUND_COLOR,
        backgroundPosition: CONFIG.DEFAULT_VALUES.BACKGROUND_POSITION,
        wrapperId: CONFIG.DEFAULT_VALUES.WRAPPER,
        showName: CONFIG.DEFAULT_VALUES.SHOW_NAME,
        ...cardData
    };

    document.getElementById('card-id').value = safeData.id;
    document.getElementById('card-name').value = safeData.name;
    document.getElementById('card-wrapper').value = safeData.wrapperId;
    document.getElementById('card-background-image').value = cardFormImageState.imageKind === 'url'
        ? mediaStorage.normalizeUrl(safeData.backgroundImage)
        : '';
    document.getElementById('card-background-color').value = safeData.backgroundColor || '#000000';

    const linkInput = document.getElementById('card-link');
    delete linkInput.dataset.fullUrl;
    if (safeData.id?.includes('default') && safeData.link) {
        linkInput.dataset.fullUrl = safeData.link;
        linkInput.value = getBaseUrl(safeData.link);
    } else {
        linkInput.value = safeData.link;
    }

    const position = safeData.backgroundPosition || '50,50';
    document.getElementById('card-background-image').dataset.position = position;
    setPositionDisplay(position);

    const backgroundSize = String(safeData.backgroundImageSize || '100%').replace('%', '');
    document.getElementById('card-background-size').value = backgroundSize;
    document.getElementById('card-background-size-value').textContent = `${backgroundSize}%`;
    setupSizeButtons(safeData.size || 'card-small');
    setVisibility(safeData.showName !== false);

    try {
        const mediaRecord = await mediaStorage.getForCard(safeData);
        if (formGeneration !== cardFormImageState.generation) return;
        if (mediaRecord?.blob) {
            if (cardFormImageState.imageKind === 'local' && !mediaRecord.revision) {
                mediaRecord.revision = await mediaStorage.fingerprintBlob(mediaRecord.blob);
                if (formGeneration !== cardFormImageState.generation) return;
                await mediaStorage.put(mediaRecord);
            }
            const revisionMatches = cardFormImageState.imageKind !== 'local'
                || !safeData.imageRevision
                || mediaRecord.revision === safeData.imageRevision;
            if (revisionMatches) {
                cardFormImageState.originalImageRevision = mediaRecord.revision || safeData.imageRevision || '';
                cardFormImageState.setPreviewBlob(mediaRecord.blob);
            }
        }
    } catch (error) {
        console.warn('Unable to load image preview:', error);
    }

    if (formGeneration !== cardFormImageState.generation) return;
    setLocalImageStatus(cardFormImageState.imageKind === 'local'
        ? window.i18n.translate(cardFormImageState.previewUrl ? 'local_image_selected' : 'local_image_missing')
        : '');
    updateCardPreview();
}

async function handleCardFormSubmit(event) {
    event.preventDefault();
    if (cardFormImageState.processing) return;
    const submissionGeneration = cardFormImageState.generation;
    cardFormImageState.processing = true;
    setCardFormBusy(true);
    const imageInput = document.getElementById('card-background-image');
    const cardId = document.getElementById('card-id').value || generateUUID();
    const remoteUrl = imageInput.value.trim();
    let imageKind = cardFormImageState.imageKind;

    if (cardFormImageState.pendingRecord) imageKind = 'local';
    else if (remoteUrl) imageKind = 'url';
    else if (imageKind !== 'local') imageKind = 'none';

    const cardData = {
        id: cardId,
        name: document.getElementById('card-name').value,
        size: document.getElementById('card-size').value,
        link: document.getElementById('card-link').dataset.fullUrl
            || document.getElementById('card-link').value,
        backgroundImage: imageKind === 'url' ? `url(${remoteUrl})` : '',
        imageKind,
        imageRevision: imageKind === 'local'
            ? (cardFormImageState.pendingRecord?.revision || cardFormImageState.originalImageRevision || '')
            : '',
        backgroundImageSize: `${document.getElementById('card-background-size').value}%`,
        backgroundPosition: imageInput.dataset.position || '50,50',
        backgroundColor: document.getElementById('card-background-color').value,
        wrapperId: document.getElementById('card-wrapper').value,
        showName: document.querySelector('.btn-visibility').classList.contains('active')
    };

    let previousLocalImage = null;
    let replacedLocalImage = false;
    let cardSaved = false;

    try {
        if (imageKind === 'local' && cardFormImageState.pendingRecord) {
            const record = cardFormImageState.pendingRecord;
            previousLocalImage = await mediaStorage.get(mediaStorage.localId(cardId));
            await mediaStorage.put({
                id: mediaStorage.localId(cardId),
                blob: record.blob,
                sourceType: 'local',
                width: record.width,
                height: record.height,
                updatedAt: Date.now(),
                revision: record.revision
            });
            replacedLocalImage = true;
        }

        await dataManager.saveCard(cardData);
        cardSaved = true;
        await renderCards();
        closeCardPopup();
        event.target.reset();
    } catch (error) {
        if (replacedLocalImage && !cardSaved) {
            try {
                if (previousLocalImage?.blob) {
                    await mediaStorage.put(previousLocalImage);
                } else {
                    await mediaStorage.remove(mediaStorage.localId(cardId));
                }
            } catch (rollbackError) {
                console.error('Unable to restore the previous local card image:', rollbackError);
            }
        }
        console.error('Unable to save card:', error);
        alert(window.i18n.translate('save_card_error'));
    } finally {
        if (submissionGeneration === cardFormImageState.generation) {
            cardFormImageState.processing = false;
            setCardFormBusy(false);
        }
    }
}

function setupSizeButtons(selectedSize = 'card-small') {
    document.querySelectorAll('.btn-card-size').forEach(button => {
        button.classList.toggle('selected', button.dataset.size === selectedSize);
    });
    document.getElementById('card-size').value = selectedSize;
    updateCardPreview();
}

function handleVisibilityToggle() {
    const button = document.querySelector('.btn-visibility');
    setVisibility(!button.classList.contains('active'));
    updateCardPreview();
}

function setVisibility(visible) {
    document.querySelector('.btn-visibility').classList.toggle('active', Boolean(visible));
}

async function deleteCard() {
    const cardId = document.getElementById('card-id').value;
    if (!cardId) return false;
    const cards = await dataManager.getAllCards();
    const card = cards.find(item => item.id === cardId);
    if (!card) return false;

    const confirmMessage = window.i18n.translate('confirm_delete_card', [card.name]);
    if (!window.confirm(confirmMessage)) return false;

    await dataManager.deleteCard(cardId);
    await renderCards();
    return true;
}

async function resetCardForm() {
    cardFormImageState.reset();
    setCardFormBusy(false);
    const form = document.getElementById('new-card-form');
    form.reset();
    document.getElementById('card-id').value = '';
    document.getElementById('delete-card-btn').style.display = 'none';
    document.getElementById('form-main-buttons').classList.add('single-button');
    delete document.getElementById('card-link').dataset.fullUrl;
    document.getElementById('card-background-image').dataset.position = '50,50';
    document.getElementById('card-background-size').value = 100;
    document.getElementById('card-background-size-value').textContent = '100%';
    document.getElementById('card-background-color').value = CONFIG.DEFAULT_VALUES.BACKGROUND_COLOR;
    setupSizeButtons(CONFIG.DEFAULT_VALUES.SIZE);
    setVisibility(CONFIG.DEFAULT_VALUES.SHOW_NAME);
    setPositionDisplay('50,50');
    setLocalImageStatus('');
    updateCardPreview();
}

function setPositionDisplay(position) {
    const [x, y] = String(position || '50,50').split(',');
    const imageInput = document.getElementById('card-background-image');
    imageInput.dataset.position = `${x},${y}`;
    const [horizontalDiv, verticalDiv] = document.querySelector('.position-values').children;
    if (horizontalDiv && verticalDiv) {
        horizontalDiv.textContent = `${window.i18n.translate('horizontal')}: ${x}%`;
        verticalDiv.textContent = `${window.i18n.translate('vertical')}: ${y}%`;
    }
}

function setLocalImageStatus(message) {
    document.getElementById('local-image-status').textContent = message || '';
}

function setCardFormBusy(busy) {
    const saveButton = document.querySelector('#new-card-form button[type="submit"]');
    const fileButton = document.getElementById('select-image-file-btn');
    if (saveButton) saveButton.disabled = Boolean(busy);
    if (fileButton) fileButton.disabled = Boolean(busy);
}
