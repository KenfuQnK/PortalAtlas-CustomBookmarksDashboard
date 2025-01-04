// Function to set up the wrapper popup
function setupWrapperPopup() {
    const addWrapperBtn = document.getElementById('add-wrapper-btn');
    const popupFormWrapper = document.getElementById('popup-form-wrapper');
    const closePopupWrapper = document.getElementById('close-popup-wrapper');
    const newWrapperForm = document.getElementById('new-wrapper-form');
    const deleteWrapperBtn = document.getElementById('delete-wrapper-btn'); 

    // Add event listener to show the popup form when the add button is clicked
    addWrapperBtn.addEventListener('click', () => {
        resetWrapperForm(); // Reset the form fields
        popupFormWrapper.style.display = 'block'; // Show the popup form
    });

    // Add event listener to close the popup when the close button is clicked
    closePopupWrapper.addEventListener('click', () => {
        popupFormWrapper.style.display = 'none'; // Hide the popup form
    });

    // Add event listener to close the popup when clicking outside of it
    window.addEventListener('click', (event) => {
        if (event.target === popupFormWrapper) {
            popupFormWrapper.style.display = 'none'; // Hide the popup if clicked outside
        }
    });
    
    // Add event listener to delete a wrapper when the delete button is clicked
    deleteWrapperBtn.addEventListener('click', async () => {
        const wasDeleted = await deleteWrapper(); // Attempt to delete the wrapper
        if (wasDeleted) {
            popupFormWrapper.style.display = 'none'; // Hide the popup if deleted
        }
    });
    
    // Add event listener for form submission
    newWrapperForm.addEventListener('submit', handleWrapperFormSubmit); // Handle form submission
}

// Function to handle the submission of the wrapper form
async function handleWrapperFormSubmit(event) {
    event.preventDefault(); // Prevent default form submission behavior
    
    var wrapperIdElement = document.getElementById('wrapper-id'); // Get the wrapper ID input element
    var wrapperId = wrapperIdElement ? wrapperIdElement.value : null; // Get the value of the wrapper ID

    var wrapperNameElement = document.getElementById('wrapper-name'); // Get the wrapper name input element
    var wrapperName = wrapperNameElement ? wrapperNameElement.value : null; // Get the value of the wrapper name

    if (!wrapperName) {
        console.error("Wrapper name is required."); // Log an error if the wrapper name is not provided
        return; // Exit the function if the name is not provided
    }

    // Create an object to hold the wrapper data
    const wrapperData = {
        id: wrapperId || generateUUID(), // Use the provided ID or generate a new one
        name: wrapperName // Set the name of the wrapper
    };

    await dataManager.saveWrapper(wrapperData); // Save the wrapper data
    await renderWrappers(); // Render the updated list of wrappers

    document.getElementById('popup-form-wrapper').style.display = 'none'; // Hide the popup form
    event.target.reset(); // Reset the form fields
}

// Function to open the edit wrapper popup
function openEditWrapperPopup(wrapperData) {
    const popupForm = document.getElementById('popup-form-wrapper'); // Get the popup form for the wrapper
    popupForm.style.display = 'block'; // Show the popup form

    document.getElementById('wrapper-id').value = wrapperData.id; // Set the wrapper ID in the form
    document.getElementById('wrapper-name').value = wrapperData.name; // Set the wrapper name in the form
    document.getElementById('delete-wrapper-btn').style.display = 'block'; // Show the delete button when editing
    document.getElementById('form-wrapper-buttons').classList.remove('single-button'); // Adjust button layout
}

// Function to reset the wrapper form
function resetWrapperForm() {
    document.getElementById('wrapper-id').value = ''; // Clear the wrapper ID field
    document.getElementById('new-wrapper-form').reset(); // Reset the form fields
    document.getElementById('delete-wrapper-btn').style.display = 'none'; // Hide the delete button when creating a new wrapper
    document.getElementById('form-wrapper-buttons').classList.add('single-button'); // Adjust button layout
}

// Function to delete a wrapper
async function deleteWrapper() {
    const wrapperId = document.getElementById('wrapper-id').value; // Get the wrapper ID from the form
    if (!wrapperId) return false; // Exit if no wrapper ID is provided

    // Get the wrapper to display its name in the confirmation
    const wrappers = await dataManager.getAllWrappers(); // Fetch all wrappers
    const wrapper = wrappers.find(w => w.id === wrapperId); // Find the wrapper by ID
    
    if (!wrapper) return false; // Exit if the wrapper is not found

    const confirmMessage = window.i18n.translate('confirm_delete_section', [wrapper.name]); // Prepare confirmation message
    if (window.confirm(confirmMessage)) {
        await dataManager.deleteWrapper(wrapperId); // Delete the wrapper
        await renderWrappers(); // Render the updated list of wrappers
        return true; // Return success
    }
    return false; // Return failure
}
