// Wrapper functions
function createWrapper(wrapperData, isExpanded) {
    const expanded = isExpanded || false; // Determine if the wrapper should be expanded

    const wrapperDiv = document.createElement('div'); // Create a new div for the wrapper
    wrapperDiv.className = 'wrapper'; // Set the class name for styling
    wrapperDiv.id = wrapperData.id; // Set the ID of the wrapper

    const sectionHeader = document.createElement('section'); // Create a section for the header
    sectionHeader.className = 'section-header'; // Set the class name for the header
    sectionHeader.innerHTML = `<span class="toggle-icon ${!expanded ? 'collapsed' : ''}">
        <svg class="svg-snoweb svg-theme-light" height="50" preserveaspectratio="xMidYMid meet" viewbox="0 -12 100 100" width="100" x="0" xmlns="http://www.w3.org/2000/svg" y="0">
            <path class="svg-fill-primary" d="M14.5,29.6a7.5,7.5,0,0,1,10.7,0L50,54.4,74.8,29.6A7.5,7.5,0,1,1,85.5,40.2L55.3,70.4a7.4,7.4,0,0,1-10.6,0L14.5,40.2A7.5,7.5,0,0,1,14.5,29.6Z" fill-rule="evenodd"></path>
        </svg></span>${wrapperData.name}`; // Set the inner HTML with the wrapper name and toggle icon

    sectionHeader.onclick = () => toggleSection(wrapperData.id); // Add click event to toggle the section

    const sectionContent = document.createElement('section'); // Create a section for the content
    sectionContent.className = `section-content ${expanded ? 'show' : ''}`; // Set class based on expanded state
//    if (expanded) {
//        sectionContent.style.maxHeight = 'none'; // Set max height if expanded
//    }
    sectionContent.id = `section-${wrapperData.id}`; // Set the ID for the content section

    const container = document.createElement('div'); // Create a container for cards within the wrapper
    container.className = 'container'; // Set the class name for the container
    sectionContent.appendChild(container); // Append the container to the section content

    wrapperDiv.appendChild(sectionHeader); // Append the header to the wrapper
    wrapperDiv.appendChild(sectionContent); // Append the content section to the wrapper

    sectionHeader.addEventListener('contextmenu', function(event) { // Add context menu event to the header
        event.preventDefault(); // Prevent default context menu
        openEditWrapperPopup(wrapperData); // Open the edit popup for the wrapper
    });

    return wrapperDiv; // Return the constructed wrapper element
}

async function renderWrappers() {
    const mainContainer = document.getElementById('main-container'); // Get the main container element
    mainContainer.innerHTML = ''; // Clear existing content in the main container
    const wrappers = await dataManager.getAllWrappers(); // Fetch all wrappers from the data manager
    const states = await dataManager.getWrapperStates(); // Fetch the states of the wrappers

    wrappers
        .sort((a, b) => (a.order || 0) - (b.order || 0)) // Sort wrappers by order
        .forEach(wrapperData => {
            // Check if this wrapper was expanded
            const isExpanded = Boolean(states[wrapperData.id]); // Determine if the wrapper should be expanded based on its state
            const wrapperElement = createWrapper(wrapperData, isExpanded); // Create the wrapper element
            mainContainer.appendChild(wrapperElement); // Append the wrapper element to the main container
        });

    await renderCards(); // Render the cards within the wrappers
    setupSortable(); // Set up sortable functionality for the wrappers
}

async function saveWrapperStates() {
    const wrappers = document.querySelectorAll('.wrapper'); // Select all wrapper elements
    const states = {}; // Initialize an object to hold the states of the wrappers
    
    wrappers.forEach(wrapper => {
        const sectionContent = wrapper.querySelector('.section-content'); // Get the content section of the wrapper
        if (sectionContent) {
            states[wrapper.id] = sectionContent.classList.contains('show'); // Save the expanded state of the wrapper
        }
    });
    
    await dataManager.saveWrapperStates(states); // Save the states to the data manager
}

// Function to load wrappers into the select element
async function loadWrapperSelect() {
    try {
        const wrapperSelect = document.getElementById('card-wrapper'); // Get the select element for wrappers
        if (!wrapperSelect) {
            console.error('Wrapper select element not found'); // Log error if the select element is not found
            return;
        }

        const wrappers = await dataManager.getAllWrappers(); // Fetch all wrappers
        if (!Array.isArray(wrappers)) {
            console.error('Loaded wrappers is not an array:', wrappers); // Log error if the loaded wrappers are not an array
            return;
        }

        wrapperSelect.innerHTML = ''; // Clear existing options in the select element
        
        wrappers
            .sort((a, b) => (a.order || 0) - (b.order || 0)) // Sort wrappers by order
            .forEach(wrapper => {
                if (wrapper && wrapper.id && wrapper.name) { // Check if the wrapper has valid properties
                    const option = document.createElement('option'); // Create a new option element
                    option.value = wrapper.id; // Set the value of the option to the wrapper ID
                    option.textContent = wrapper.name; // Set the display text of the option to the wrapper name
                    wrapperSelect.appendChild(option); // Append the option to the select element
                }
            });
    } catch (error) {
        console.error('Error loading wrappers:', error); // Log error if loading wrappers fails
    }
}

// Toggle section visibility
function toggleSection(wrapperId) {
    const section = document.getElementById(wrapperId);
    const sectionContent = section.getElementsByClassName("section-content")[0];
    const icon = section.querySelector('.toggle-icon');
    
    if (sectionContent.classList.contains('show')) {
        // Guardar la altura actual antes de colapsar
        const currentHeight = sectionContent.scrollHeight;
        sectionContent.style.maxHeight = currentHeight + 'px';
        
        // Forzar un reflow
        sectionContent.offsetHeight;
        
        // Colapsar
        sectionContent.style.maxHeight = '0px';
        sectionContent.classList.remove('show');
        icon.classList.add('collapsed');
        
        // Limpiar maxHeight después de la transición
        sectionContent.addEventListener('transitionend', function handler() {
            sectionContent.style.maxHeight = null;
            sectionContent.removeEventListener('transitionend', handler);
        }, { once: true });
    } else {
        // Expandir
        sectionContent.classList.add('show');
        icon.classList.remove('collapsed');
        
        // Establecer la altura máxima al valor real del contenido
        const totalHeight = sectionContent.scrollHeight;
        sectionContent.style.maxHeight = totalHeight + 'px';
        
        // Limpiar maxHeight después de la transición
        sectionContent.addEventListener('transitionend', function handler() {
            sectionContent.style.maxHeight = 'none';
            sectionContent.removeEventListener('transitionend', handler);
        }, { once: true });
    }
    
    saveWrapperStates();
}

// Setup Sortable
function setupSortable() {
    const mainContainer = document.getElementById('main-container'); // Get the main container element
    new Sortable(mainContainer, { // Initialize Sortable on the main container
        animation: 150, // Set animation duration
        handle: '.section-header', // Set the handle for dragging to the section header
        onEnd: updateWrapperOrder // Set the callback for when sorting ends
    });

    document.querySelectorAll('.container').forEach(container => { // For each container in the wrappers
        new Sortable(container, { // Initialize Sortable on the container
            animation: 150, // Set animation duration
            group: 'cards', // Set the group for card sorting
            onEnd: async (evt) => { // Set the callback for when sorting ends
                // Wait for the order update to complete before rendering
                await updateCardOrder(); // Update the order of cards
                // Only render if the card was moved to a different wrapper
                if (evt.from !== evt.to) {
                    await renderCards(); // Render the cards in the new order
                }
            }
        });
    });
}

// Update orders after sorting
async function updateWrapperOrder() {
    const wrapperElements = Array.from(document.querySelectorAll('.wrapper')); // Get all wrapper elements
    const wrapperIds = wrapperElements.map(element => element.id); // Extract the IDs of the wrappers
    await dataManager.updateWrapperOrder(wrapperIds); // Update the order of the wrappers in the data manager
}
