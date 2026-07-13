// Initialization
document.addEventListener("DOMContentLoaded", async function() {
    try {
        // Prepare the v2 local mirror, migrate v1 data and hydrate Chrome Sync
        // before any UI reads the dashboard.
        await storage.initialize();

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
                updateDriveSettingsUI();
            });
        }

        await initNavigation();
        await renderWrappers();
        setupPopupForm();
        setupWrapperPopup();
        setupExportImport();
        setupSettingsModal();

        // Drive is deliberately initialized after the local dashboard is
        // usable. Authorization and network failures can never block startup.
        driveSync.initialize().catch(error => {
            console.warn('Optional Google Drive sync could not initialize:', error);
        });

        let remoteRenderScheduled = false;
        let pendingDashboardRender = false;
        const pendingDriveImageIds = new Set();
        const scheduleRemoteRender = () => {
            if (remoteRenderScheduled) return;
            remoteRenderScheduled = true;
            requestAnimationFrame(async () => {
                remoteRenderScheduled = false;
                const renderDashboard = pendingDashboardRender;
                const imageIds = new Set(pendingDriveImageIds);
                pendingDashboardRender = false;
                pendingDriveImageIds.clear();

                if (renderDashboard) await renderWrappers();
                if (imageIds.size > 0) await renderCards({ forceImageIds: imageIds });
            });
        };

        window.addEventListener('portal-atlas-data-changed', () => {
            driveSync.notifyDataChanged();
            pendingDashboardRender = true;
            scheduleRemoteRender();
        });

        window.addEventListener('portal-atlas-drive-images-changed', event => {
            (event.detail?.cardIds || []).forEach(cardId => pendingDriveImageIds.add(cardId));
            scheduleRemoteRender();
        });

    } catch (error) {
        console.error('Error initializing:', error);
    }
});
