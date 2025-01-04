// Initialization
document.addEventListener("DOMContentLoaded", async function() {
    try {
        // Initialize i18n at the very first
        await window.i18n.init();

        // Initialize default data if needed
        await storage.initializeDefaultData();
        
        // Set language selector
        const languageSelector = document.getElementById('language-selector');
        if (languageSelector) {
            languageSelector.value = window.i18n.currentLanguage;
            
            languageSelector.addEventListener('change', async (e) => {
                await window.i18n.setLanguage(e.target.value);
            });
        }

        await initNavigation();
        await renderWrappers();
        setupPopupForm();
        setupWrapperPopup();
        setupSortable();
        setupExportImport();
        setupSettingsModal();

    } catch (error) {
        console.error('Error initializing:', error);
    }
});