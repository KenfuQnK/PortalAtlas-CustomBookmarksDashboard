// Popup functions
function setupPopupForm() {
    // Get references to the necessary DOM elements for the popup form
    const addCardBtn = document.getElementById('add-card-btn');
    const deleteCardBtn = document.getElementById('delete-card-btn');
    const popupForm = document.getElementById('popup-form-card');
    const closePopup = document.getElementById('close-popup-card');
    const newCardForm = document.getElementById('new-card-form');
    const colorBtn = document.getElementById('card-background-color');
    const resetImageBtn = document.getElementById('reset-image-btn');
    const resetLinkBtn = document.getElementById('reset-link-btn');
    
    // Add event listener for resetting the image input
    resetImageBtn.addEventListener('click', async () => {
        // Get the card ID and relevant input elements
        const cardId = document.getElementById('card-id').value;
        const imageInput = document.getElementById('card-background-image');
        const sizeInput = document.getElementById('card-background-size');
        const sizeValueDisplay = document.getElementById('card-background-size-value');
        
        if (cardId) {
            // If card exists, reset to original image
            await resetImageToOriginal(cardId);
            debug('Image reset to original version');
        } else {
            // If new card, reset fields manually
            if (imageInput) imageInput.value = '';
            if (sizeInput) sizeInput.value = '100';
            if (sizeValueDisplay) sizeValueDisplay.textContent = '100%';
        }
        // Update the card preview after resetting
        updateCardPreview();
    });

    // Add event listener for resetting the link input
    resetLinkBtn.addEventListener('click', () => {
        const linkInput = document.getElementById('card-link');
        if (linkInput) {
            linkInput.value = ""; // Clear the link input
            updateCardPreview(); // Update the card preview
        }
    });
    
    // Add event listener for adding a new card
    addCardBtn.addEventListener('click', async () => {
        resetCardForm(); // Reset the card form
        await loadWrapperSelect(); // Load the wrapper select options
        popupForm.style.display = 'block'; // Show the popup form
    });

    // Add event listener for deleting a card
    deleteCardBtn.addEventListener('click', async () => {
        const wasDeleted = await deleteCard(); // Attempt to delete the card
        if (wasDeleted) {
            document.getElementById('popup-form-card').style.display = 'none'; // Hide the popup if deleted
        }
    });

    // Add event listener for closing the popup
    closePopup.addEventListener('click', () => popupForm.style.display = 'none'); // Hide the popup

    // Add event listener to close the popup when clicking outside of it
    window.addEventListener('click', (event) => {
        if (event.target === popupForm) {
            popupForm.style.display = 'none'; // Hide the popup if clicked outside
        }
    });

    // Add event listener for form submission
    newCardForm.addEventListener('submit', handleCardFormSubmit);

    // Listeners for updating the card preview
    const updatePreviewInputs = [
        'card-name',
        'card-background-image',
        'card-background-size',
        'card-background-color'
    ];

    // Add input event listeners to update the preview
    updatePreviewInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('input', updateCardPreview); // Update preview on input
        }
    });

    // Add event listener for visibility button
    const visibilityBtn = document.querySelector('.btn-visibility');
    if (visibilityBtn) {
        visibilityBtn.addEventListener('click', updateCardPreview); // Update preview on visibility toggle
    }

    setupVisibilityButton(); // Setup visibility button functionality

    // Update the preview when card size buttons are clicked
    const sizeButtons = document.querySelectorAll('.btn-card-size');
    sizeButtons.forEach(button => {
        button.addEventListener('click', updateCardPreview); // Update preview on size button click
    });

    // Configure the slider for background size input
    const sizeInput = document.getElementById('card-background-size');
    const sizeValueDisplay = document.getElementById('card-background-size-value');

    if (sizeInput && sizeValueDisplay) {
        function updateSize() {
            sizeValueDisplay.textContent = this.value + "%"; // Display the current size value
            updateCardPreview(); // Update the card preview
        }

        sizeInput.addEventListener('input', updateSize); // Update size on input change
        sizeInput.addEventListener('change', updateSize); // Update size on change
    }
}

// Popup management
async function openEditPopup(cardData) {
    try {
        // First load the wrappers for the select input
        await loadWrapperSelect();
        
        const popupForm = document.getElementById('popup-form-card');
        if (!popupForm) {
            console.error('Popup form not found'); // Log error if popup form is not found
            return;
        }
        popupForm.style.display = 'block'; // Show the popup form

        // Show the delete button when editing a card
        document.getElementById('delete-card-btn').style.display = 'block';
        document.getElementById('form-main-buttons').classList.remove('single-button');

        // Define default values for missing data
        const defaultData = {
            id: CONFIG.DEFAULT_VALUES.ID,
            name: CONFIG.DEFAULT_VALUES.NAME,
            link: CONFIG.DEFAULT_VALUES.LINK,
            size: CONFIG.DEFAULT_VALUES.SIZE,
            backgroundImage: CONFIG.DEFAULT_VALUES.BACKGROUND_IMAGE,
            backgroundImageSize: CONFIG.DEFAULT_VALUES.BACKGROUND_SIZE,
            backgroundColor: CONFIG.DEFAULT_VALUES.BACKGROUND_COLOR,
            backgroundPosition: CONFIG.DEFAULT_VALUES.BACKGROUND_POSITION,
            wrapperId: CONFIG.DEFAULT_VALUES.SIZE,
            showName: CONFIG.DEFAULT_VALUES.SHOW_NAME
        };

        // Combine existing data with default values
        const safeData = { ...defaultData, ...cardData };

        // Map fields to their corresponding values
        const fieldMap = {
            'card-id': safeData.id,
            'card-name': safeData.name,
            'card-link': safeData.link,
            'card-background-image': safeData.backgroundImage ? safeData.backgroundImage.replace(/^url\(['"]?|['"]?\)$/g, '') : '',
            'card-background-size': safeData.backgroundImageSize ? safeData.backgroundImageSize.replace('%', '') : '100',
            'card-background-color': safeData.backgroundColor || '#000000',
            'card-size': safeData.size || 'card-small',
            'card-wrapper': safeData.wrapperId,
        };

        // Set the initial visibility state
        const visibilityBtn = document.querySelector('.btn-visibility');
        if (visibilityBtn) {
            const showName = cardData.showName !== false; // Determine if the name should be shown
            visibilityBtn.classList.toggle('active', showName); // Set the visibility button state
            setupVisibilityButton(); // Setup visibility button functionality
        }

        // Set values safely in the form fields
        Object.entries(fieldMap).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.value = value; // Set the value of the form field
            } else {
                console.warn(`Element with id '${id}' not found`); // Log warning if element is not found
            }
        });

        // Check if card is default
        const linkInput = document.getElementById('card-link');
        if (linkInput) {
            //if (safeData.hasOwnProperty('isDefault') && safeData.isDefault) {
            if (safeData.id && safeData.id.includes('default')) {
                linkInput.dataset.fullUrl = safeData.link;
                linkInput.value = getBaseUrl(safeData.link);
            } else {
                linkInput.value = safeData.link;
            }
        }
        
        // Configure the background image position safely
        const cardBackgroundImage = document.getElementById('card-background-image');
        const cardBackgroundPositionValue = document.querySelector('.position-values');
        
        if (cardBackgroundImage) {
            try {
                const [x, y] = (safeData.backgroundPosition || "50,50").split(',').map(Number); // Parse position values
                cardBackgroundImage.dataset.position = `${x},${y}`; // Set the position data attribute
                cardBackgroundImage.style.backgroundPosition = `${x}% ${y}%`; // Set the background position style
                
                // Ensure the preview also has the correct position
                const preview = document.getElementById('card-preview');
                if (preview) {
                    preview.style.backgroundPosition = `${x}% ${y}%`; // Set the preview background position
                }

                if (cardBackgroundPositionValue) {
                    const [horizontalDiv, verticalDiv] = cardBackgroundPositionValue.children;
                    if (horizontalDiv && verticalDiv) {
                        const horizontalText = window.i18n.translate('horizontal'); // Get translated horizontal text
                        const verticalText = window.i18n.translate('vertical'); // Get translated vertical text
                        horizontalDiv.textContent = `${horizontalText}: ${x}%`; // Update horizontal position text
                        verticalDiv.textContent = `${verticalText}: ${y}%`; // Update vertical position text
                    }
                }
            } catch (error) {
                console.warn('Error setting background position, using defaults'); // Log warning on error
                cardBackgroundImage.dataset.position = "50,50"; // Reset to default position
                const [horizontalDiv, verticalDiv] = cardBackgroundPositionValue.children;
                if (horizontalDiv && verticalDiv) {
                    const horizontalText = window.i18n.translate('horizontal'); // Get translated horizontal text
                    const verticalText = window.i18n.translate('vertical'); // Get translated vertical text
                    horizontalDiv.textContent = `${horizontalText}: 50%`; // Set default horizontal text
                    verticalDiv.textContent = `${verticalText}: 50%`; // Set default vertical text                   
                }
                cardBackgroundImage.style.backgroundPosition = "50% 50%"; // Set default background position
            }
        }

        // Configure the background size input safely
        const cardBackgroundSizeInput = document.getElementById('card-background-size');
        const cardBackgroundSizeValue = document.getElementById('card-background-size-value');
        if (cardBackgroundSizeInput && cardBackgroundSizeValue) {
            const sizeValue = safeData.backgroundImageSize ? 
                safeData.backgroundImageSize.replace('%', '') : '100'; // Get size value
            cardBackgroundSizeInput.value = sizeValue; // Set the size input value
            cardBackgroundSizeValue.textContent = sizeValue + "%"; // Display the size value
        }

        // Setup size buttons and update preview
        try {
            setupSizeButtons(safeData.size); // Setup size buttons based on safe data
            updateCardPreview(); // Update the card preview
        } catch (error) {
            console.warn('Error setting up size buttons or preview:', error); // Log warning on error
        }

        setupVisibilityButton(); // Setup visibility button functionality
        setupImageSizeHandlers(); // Setup image size handlers
        setupImagePositionButtons(); // Setup image position buttons
    } catch (error) {
        console.error('Error opening edit popup:', error); // Log error if popup fails to open
    }
}

// Form handling functions
async function handleCardFormSubmit(event) {
    event.preventDefault(); // Prevent default form submission

    // Gather form data into an object
    const formData = {
        cardId: document.getElementById('card-id').value,
        name: document.getElementById('card-name').value,
        link: document.getElementById('card-link').dataset.fullUrl || document.getElementById('card-link').value,
        backgroundImage: document.getElementById('card-background-image').value,
        backgroundSize: document.getElementById('card-background-size').value,
        backgroundColor: document.getElementById('card-background-color').value,
        backgroundPosition: document.getElementById('card-background-image').dataset.position || '50,50',
        size: document.getElementById('card-size').value,
        wrapperId: document.getElementById('card-wrapper').value, 
        showName: document.querySelector('.btn-visibility').classList.contains('active') // Check if name should be shown
    };

    try {
        let base64Image = null; // Initialize base64 image variable
        if (formData.backgroundImage) {
            base64Image = await convertImageToBase64(formData.backgroundImage); // Convert image to base64 if provided
        }

        // Create card data object to save
        const cardData = {
            id: formData.cardId || generateUUID(), // Ensure card has an ID
            name: formData.name,
            size: formData.size,
            link: formData.link,
            backgroundImage: formData.backgroundImage ? `url(${formData.backgroundImage})` : '', // Format background image
            backgroundImageBase64: base64Image, // Include base64 image if available
            backgroundImageSize: `${formData.backgroundSize}%`, // Set background size
            backgroundPosition: formData.backgroundPosition, // Set background position
            backgroundColor: formData.backgroundColor, // Set background color
            wrapperId: formData.wrapperId, // Set wrapper ID
            showName: formData.showName, // Set visibility of name
        };

        await dataManager.saveCard(cardData); // Save card data

        await renderCards(); // Render updated cards

        document.getElementById('popup-form-card').style.display = 'none'; // Hide the popup form
        event.target.reset(); // Reset the form

    } catch (error) {
        alert('Error saving card. Please try again.'); // Alert user of error
    }
}

// Setup image size handlers
function setupImageSizeHandlers() {
    const sizeInput = document.getElementById('card-background-size'); // Get size input element
    const sizeValueDisplay = document.getElementById('card-background-size-value'); // Get size value display element

    if (!sizeInput || !sizeValueDisplay) return; // Exit if elements are not found

    // Ensure the initial value is displayed correctly
    if (sizeInput.value) {
        sizeValueDisplay.textContent = sizeInput.value + "%"; // Display initial size value
    }

    function updateSize() {
        sizeValueDisplay.textContent = this.value + "%"; // Update displayed size value
        updateCardPreview(); // Update card preview
    }

    sizeInput.addEventListener('input', updateSize); // Update size on input change
    sizeInput.addEventListener('change', updateSize); // Update size on change
}

// Setup size buttons
function setupSizeButtons(selectedSize = 'card-small') {
    const sizeButtons = document.querySelectorAll('.btn-card-size'); // Get all size buttons
    const cardSizeInput = document.getElementById('card-size'); // Get card size input element

    sizeButtons.forEach(button => {
        button.classList.remove('selected'); // Remove selected class from all buttons
        if (button.getAttribute('data-size') === selectedSize) {
            button.classList.add('selected'); // Add selected class to the currently selected size
        }
        
        // Add click event listener to each size button
        button.addEventListener('click', function() {
            sizeButtons.forEach(btn => btn.classList.remove('selected')); // Remove selected class from all buttons
            this.classList.add('selected'); // Add selected class to the clicked button
            cardSizeInput.value = this.getAttribute('data-size'); // Set the card size input value
            updateCardPreview(); // Update card preview
        });
    });

    cardSizeInput.value = selectedSize; // Set the initial size input value
    updateCardPreview(); // Update card preview
}

// Add function to handle visibility toggle
function setupVisibilityButton() {
    const visibilityBtn = document.querySelector('.btn-visibility'); // Get visibility button
    if (!visibilityBtn) return; // Exit if button is not found
   
    function updateVisibility() {
        const showName = !visibilityBtn.classList.contains('active'); // Determine if name should be shown
        visibilityBtn.classList.toggle('active', showName); // Toggle visibility button state
        updateCardPreview(); // Update card preview
    }

    visibilityBtn.removeEventListener('click', updateVisibility); // Remove previous event listener
    visibilityBtn.addEventListener('click', updateVisibility); // Add new event listener
}

// Delete card
async function deleteCard() {
    const cardId = document.getElementById('card-id').value; // Get the card ID
    if (!cardId) return; // Exit if no card ID is provided

    // Get the card to display its name in the confirmation
    const cards = await dataManager.getAllCards(); // Fetch all cards
    const card = cards.find(card => card.id === cardId); // Find the card by ID
    
    if (!card) return; // Exit if card is not found

    const confirmMessage = window.i18n.translate('confirm_delete_card', [card.name]); // Prepare confirmation message
    if (window.confirm(confirmMessage)) {
        await dataManager.deleteCard(cardId); // Delete the card
        await renderCards(); // Render updated cards
        return true; // Return success
    }
    return false; // Return failure
}

// Form reset functions
function resetCardForm() {
    // Reset the form and the ID
    document.getElementById('card-id').value = ''; // Clear card ID
    document.getElementById('new-card-form').reset(); // Reset the form fields

    // Hide the delete button when creating a new card
    document.getElementById('delete-card-btn').style.display = 'none';
    document.getElementById('form-main-buttons').classList.add('single-button');

    // Reset full URL 
    const linkInput = document.getElementById('card-link');
    if (linkInput) {
        delete linkInput.dataset.fullUrl;
    }
    
    // Set default card size
    setupSizeButtons('card-small');
    
    // Set default background size
    const cardBackgroundSize = document.getElementById('card-background-size');
    const cardBackgroundSizeValue = document.getElementById('card-background-size-value');
    if (cardBackgroundSize) {
        cardBackgroundSize.value = 100; // Set default size value
    }
    if (cardBackgroundSizeValue) {
        cardBackgroundSizeValue.textContent = "100%"; // Display default size value
    }
    
    // Set default background position
    const cardBackgroundImage = document.getElementById('card-background-image');
    const cardBackgroundPositionValue = document.querySelector('.position-values');
    if (cardBackgroundImage) {
        cardBackgroundImage.dataset.position = '50,50'; // Set default position data attribute
        cardBackgroundImage.style.backgroundPosition = '50% 50%'; // Set default background position
    }
    if (cardBackgroundPositionValue) {
        const horizontalText = window.i18n.translate('horizontal');
        const verticalText = window.i18n.translate('vertical');
        const [horizontalDiv, verticalDiv] = cardBackgroundPositionValue.children;
        if (horizontalDiv && verticalDiv) {
            horizontalDiv.textContent = `${horizontalText}: 50%`;
            verticalDiv.textContent = `${verticalText}: 50%`;
        }
    }

    // Reset visibility state
    const visibilityBtn = document.querySelector('.btn-visibility');
    if (visibilityBtn) {
        visibilityBtn.classList.toggle('active', CONFIG.DEFAULT_VALUES.SHOW_NAME);
    }
    
    // Update the card preview
    updateCardPreview();
}
