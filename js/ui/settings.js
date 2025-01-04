// Function to configure Settings modal
function setupSettingsModal() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPopup = document.getElementById('popup-form-settings');
    const closeSettingsPopup = document.getElementById('close-popup-settings');

    settingsBtn.addEventListener('click', () => {
        settingsPopup.style.display = 'block';
    });

    closeSettingsPopup.addEventListener('click', () => {
        settingsPopup.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === settingsPopup) {
            settingsPopup.style.display = 'none';
        }
    });
}