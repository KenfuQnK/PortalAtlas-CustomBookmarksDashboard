// Card functions
function createCard(cardData) {
    const anchor = document.createElement("a"); // Create an anchor element for the card
    anchor.className = `card ${cardData.size}`; // Set the class name for styling based on card size
    anchor.id = cardData.id || generateUUID(); // Set the ID of the card or generate a new one
    anchor.href = cardData.link; // Set the link for the card
    anchor.textContent = cardData.showName !== false ? cardData.name : ' '; // Set the card name or empty space if not shown
    
    // Extract the clean original URL from the background image
    const originalUrl = cardData.backgroundImage.replace(/^url\(['"]?|['"]?\)$/g, '');
    
    // If we have a base64 image, start with it for quick loading
    if (cardData.backgroundImageBase64) {
        anchor.style.backgroundImage = `url(${cardData.backgroundImageBase64})`; // Set the background image to the base64 version
        
        // Preload and transition to the original image
        if (originalUrl) {
            preloadAndSwitchImage(anchor, originalUrl); // Preload the original image and switch to it
        }
    } else if (originalUrl) {
        // If no base64 image, use the original URL directly
        anchor.style.backgroundImage = `url(${originalUrl})`; // Set the background image to the original URL
    }
    
    // Apply other styles
    anchor.style.backgroundSize = cardData.backgroundImageSize; // Set the background size
    anchor.style.backgroundColor = cardData.backgroundColor; // Set the background color
    
    const [x, y] = (cardData.backgroundPosition || "50,50").split(','); // Get the background position values
    anchor.style.backgroundPosition = `${x}% ${y}%`; // Set the background position

    anchor.addEventListener('contextmenu', async function(event) {
        event.preventDefault(); // Prevent the default context menu from appearing
        await openEditPopup(cardData); // Open the edit popup for the card
    });

    return anchor; // Return the constructed card element
}

async function renderCards() {
    const wrappers = document.querySelectorAll('.wrapper'); // Select all wrapper elements
    const cardsData = await dataManager.getAllCards(); // Fetch all card data

    wrappers.forEach(wrapper => {
        const container = wrapper.querySelector('.container'); // Get the container for cards within the wrapper
        if (!container) {
            return; // Exit if the container is not found
        }
        container.innerHTML = ''; // Clear existing cards in the container
        
        const cardsForWrapper = cardsData
            .filter(card => card.wrapperId === wrapper.id); // Filter cards that belong to the current wrapper
               
        cardsForWrapper
            .sort((a, b) => (a.order || 0) - (b.order || 0)) // Sort cards by order
            .forEach(cardData => {
                container.appendChild(createCard(cardData)); // Create and append each card to the container
            });
    });
}

async function updateCardOrder() {
    const wrappers = document.querySelectorAll('.wrapper'); // Select all wrapper elements
    const cards = await dataManager.getAllCards(); // Fetch all card data
    const updatedCards = [...cards]; // Create a copy of the current cards
    
    for (const wrapper of wrappers) {
        const wrapperId = wrapper.id; // Get the ID of the current wrapper
        const cardElements = Array.from(wrapper.querySelectorAll('.card')); // Get all card elements within the wrapper
        
        cardElements.forEach((cardElement, index) => {
            const cardIndex = updatedCards.findIndex(card => card.id === cardElement.id); // Find the index of the card in the updated cards
            if (cardIndex !== -1) {
                updatedCards[cardIndex] = {
                    ...updatedCards[cardIndex],
                    order: index, // Update the order of the card
                    wrapperId: wrapperId // Update the wrapper ID for the card
                };
            }
        });
    }
    
    await storage.set(CONFIG.STORAGE_KEYS.CARDS, updatedCards); // Save the updated card order to storage
}

function preloadAndSwitchImage(element, originalUrl) {
    if (!originalUrl || !element) return;

    const img = new Image(); // Create a new image element for preloading
    let switched = false;
    
    const timeoutDuration = 5000; // 5 seconds timeout
    const timeout = setTimeout(() => {
        if (!switched) {
            //console.warn('Image load timeout:', originalUrl);
        }
    }, timeoutDuration);
    
    img.onload = function() {
        clearTimeout(timeout);
        switched = true;
        // Add a smooth transition for the image switch
        element.style.transition = 'background-image 0.3s ease-in-out'; // Set the transition effect
        element.style.backgroundImage = `url(${originalUrl})`; // Switch to the original image
        
        // Clear the transition after a short time
        setTimeout(() => {
            element.style.transition = ''; // Reset the transition property
        }, 300);
    };

    // Keep the base64 version if original fails to load
    img.onerror = function() {
        clearTimeout(timeout);
        console.warn('Failed to load image:', originalUrl);        
    };
    
    img.src = originalUrl; // Start loading the original image
}

// Function to convert an image URL to base64
async function convertImageToBase64(imageUrl) {
    if (!imageUrl) return null; // Return null if no image URL is provided
    
    const cleanUrl = imageUrl.replace(/^url\(['"]?|['"]?\)$/g, ''); // Clean the URL format
    
    return new Promise((resolve, reject) => {
        const img = new Image(); // Create a new image element
        img.crossOrigin = "Anonymous"; // Set cross-origin attribute for loading
        
        img.onload = function() {
            const canvas = document.createElement('canvas'); // Create a canvas element
            const ctx = canvas.getContext('2d'); // Get the 2D drawing context
            
            // Reduce size for the base64 version since it's temporary
            let newWidth, newHeight;
            const maxSize = 200; // Reduced size for the base64 version
            
            if (img.width > img.height) {
                newWidth = Math.min(maxSize, img.width); // Set new width based on max size
                newHeight = (newWidth * img.height) / img.width; // Calculate new height to maintain aspect ratio
            } else {
                newHeight = Math.min(maxSize, img.height); // Set new height based on max size
                newWidth = (newHeight * img.width) / img.height; // Calculate new width to maintain aspect ratio
            }
            
            canvas.width = newWidth; // Set canvas width
            canvas.height = newHeight; // Set canvas height
            
            // Use a lower quality for the temporary base64
            ctx.drawImage(img, 0, 0, newWidth, newHeight); // Draw the image on the canvas
            const base64 = canvas.toDataURL('image/jpeg', 0.6); // Convert canvas to base64 format
            resolve(base64); // Resolve the promise with the base64 string
        };
        
        img.onerror = () => {
            console.error('Error loading image:', cleanUrl); // Log error if loading fails
            resolve(null); // Resolve with null on error
        };
        
        img.src = cleanUrl; // Start loading the image
    });
}

// Function to reset the image to its original state
async function resetImageToOriginal(cardId) {
    if (!cardId) {
        debug('No card ID provided'); // Log debug message if no card ID is provided
        return; // Exit if no card ID is provided
    }
    
    try {
        const cards = await dataManager.getAllCards(); // Fetch all cards
        const card = cards.find(card => card.id === cardId); // Find the card by ID
    
        if (card) {
            // Instead of modifying and saving the card, we save the original values
            const originalValues = {
                backgroundImage: card.backgroundImage, // Store the original background image
                backgroundImageBase64: card.backgroundImageBase64, // Store the original base64 image
                backgroundImageSize: card.backgroundImageSize, // Store the original background image size
                backgroundPosition: card.backgroundPosition // Store the original background position
            };

            // Update only the UI
            const cardBackgroundImage = document.getElementById('card-background-image'); // Get the background image input
            const cardBackgroundSize = document.getElementById('card-background-size'); // Get the background size input
            const cardBackgroundSizeValue = document.getElementById('card-background-size-value'); // Get the background size value display
            const cardBackgroundImagePosition = document.querySelector('.position-values'); // Get the position values display
            
            if (cardBackgroundImage) {
                cardBackgroundImage.value = ''; // Clear the background image input
                cardBackgroundImage.dataset.position = '50,50'; // Reset the position data attribute
                cardBackgroundImage.style.backgroundPosition = '50% 50%'; // Reset the background position
                
                // Store the original values as data attributes for recovery if canceled
                cardBackgroundImage.dataset.originalImage = originalValues.backgroundImage; // Store original image
                cardBackgroundImage.dataset.originalBase64 = originalValues.backgroundImageBase64; // Store original base64 image
                cardBackgroundImage.dataset.originalSize = originalValues.backgroundImageSize; // Store original size
                cardBackgroundImage.dataset.originalPosition = originalValues.backgroundPosition; // Store original position
            }
            
            if (cardBackgroundSize) {
                cardBackgroundSize.value = 100; // Set default size value
            }
            
            if (cardBackgroundSizeValue) {
                cardBackgroundSizeValue.textContent = "100%"; // Display default size value
            }
            
            if (cardBackgroundImagePosition) {
                if (horizontalDiv && verticalDiv) {
                    const horizontalText = window.i18n.translate('horizontal'); // Translate horizontal text
                    const verticalText = window.i18n.translate('vertical'); // Translate vertical text
                    horizontalDiv.textContent = `${horizontalText}: 50%`; // Set default horizontal text
                    verticalDiv.textContent = `${verticalText}: 50%`; // Set default vertical text
                }
            }
            
            // Update the preview
            updateCardPreview(); // Refresh the card preview
            
            debug('Image and values reset only in the UI'); // Log debug message
        } else {
            debug('Card not found with ID:', cardId); // Log debug message if card is not found
        }
    } catch (error) {
        console.error('Error resetting image:', error); // Log error if resetting fails
    }
}

function updateCardPreview() {
    const preview = document.getElementById('card-preview'); // Get the card preview element
    if (!preview) return; // Exit if the preview element is not found

    const name = document.getElementById('card-name').value; // Get the card name from the input
    const backgroundImage = document.getElementById('card-background-image').value; // Get the background image URL
    const backgroundSize = document.getElementById('card-background-size').value; // Get the background size
    const backgroundColor = document.getElementById('card-background-color').value; // Get the background color
    const cardSize = document.getElementById('card-size').value; // Get the card size
    const showName = document.querySelector('.btn-visibility').classList.contains('active'); // Check if the name should be shown
    
    // Update class and base dimensions
    preview.className = `card ${cardSize}`; // Set the class for the preview based on card size
    preview.textContent = showName ? (name || 'Preview') : ''; // Set the text content based on visibility

    // Apply image and background size
    if (backgroundImage) {
        preview.style.backgroundImage = `url(${backgroundImage})`; // Set the background image
        preview.style.backgroundSize = `${backgroundSize}%`; // Set the background size
    } else {
        preview.style.backgroundImage = 'none'; // Clear the background image if none is provided
    }
    
    preview.style.backgroundColor = backgroundColor; // Set the background color
    
    // Update background position
    const cardBackgroundImage = document.getElementById('card-background-image'); // Get the background image input
    if (cardBackgroundImage && cardBackgroundImage.dataset.position) {
        const [x, y] = cardBackgroundImage.dataset.position.split(',').map(Number); // Get the position values
        preview.style.backgroundPosition = `${x}% ${y}%`; // Set the background position
    }
}

function adjustImagePosition(direction) {
    const cardBackgroundImage = document.getElementById('card-background-image'); // Get the background image input
    const cardBackgroundPositionValue = document.querySelector('.position-values'); // Get the position values display
    const backgroundSize = parseInt(document.getElementById('card-background-size').value); // Get the background size

    if (!cardBackgroundImage || !cardBackgroundPositionValue) {
        console.warn('Required elements not found for position adjustment'); // Log warning if elements are not found
        return; // Exit if required elements are not found
    }
    
    let [x, y] = cardBackgroundImage.dataset.position ? cardBackgroundImage.dataset.position.split(',').map(Number) : [50, 50]; // Get current position or default to 50%
    debug("Received x:", x); // Log the current x position
    debug("Received y:", y); // Log the current y position

    // Adjust position
    const step = 5; // Amount to move on each click
    // Invert the direction if the size is greater than 100%
    const invertY = backgroundSize > 100;
    const invertX = backgroundSize > 100;
    
    switch(direction) {
        case 'up':
            y = Math.max(0, y - (invertY ? -step : step)); // Move up
            break;
        case 'right':
            x = Math.min(100, x + (invertX ? -step : step)); // Move right
            break;
        case 'down':
            y = Math.min(100, y + (invertY ? -step : step)); // Move down
            break;
        case 'left':
            x = Math.max(0, x + (invertX ? step : -step)); // Move left
            break;
    }
    
    cardBackgroundImage.dataset.position = `${x},${y}`; // Update the position data attribute
    cardBackgroundImage.style.backgroundPosition = `${x}% ${y}%`; // Set the background position
    // Update the text divs that show the position
    const [horizontalDiv, verticalDiv] = cardBackgroundPositionValue.children; // Get the position value display elements
    if (horizontalDiv && verticalDiv) {
        const horizontalText = window.i18n.translate('horizontal'); // Get translated horizontal text
        const verticalText = window.i18n.translate('vertical'); // Get translated vertical text
        horizontalDiv.textContent = `${horizontalText}: ${x}%`; // Update horizontal position text
        verticalDiv.textContent = `${verticalText}: ${y}%`; // Update vertical position text
    }

    const preview = document.getElementById('card-preview'); // Get the card preview element
    if (preview) {
        preview.style.backgroundPosition = `${x}% ${y}%`; // Update the preview background position
    }

    updateCardPreview(); // Refresh the card preview
}


function setupImagePositionButtons() {
    const imagePositionButtons = document.querySelector('.image-position-buttons'); // Get the image position buttons container
    if (!imagePositionButtons) return; // Exit if the container is not found
    
    imagePositionButtons.removeEventListener('click', handleImagePositionButtons); // Remove previous event listener
    imagePositionButtons.addEventListener('click', handleImagePositionButtons); // Add new event listener
    
}

//Configure the buttons for adjusting image position
function handleImagePositionButtons(event) {    
    const button = event.target.closest('.btn-image-position');
    if (!button) return;
    
    const direction = button.getAttribute('data-direction');
    if (direction) {
        adjustImagePosition(direction);
    }
}