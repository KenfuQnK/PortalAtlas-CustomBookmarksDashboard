// Initialization
document.addEventListener("DOMContentLoaded", async function() {
    try {
        // Existing v1 data must be backed up before storage.initialize() can
        // migrate it or remove the legacy keys after a successful Sync write.
        await ensureV2MigrationBackup({ beforeMigrationOnly: true });

        // Prepare the v2 local mirror, migrate v1 data and hydrate Chrome Sync
        // before any UI reads the dashboard.
        await storage.initialize();

        // Initialize i18n at the very first
        await window.i18n.init();

        // Initialize default data if needed
        await storage.initializeDefaultData();

        // A clean v2 install has no legacy data to protect. Export its newly
        // initialized dashboard now; updates already completed above are no-ops.
        try {
            await ensureV2MigrationBackup();
        } catch (error) {
            // Keep a fresh v2 dashboard usable and retry on its next opening.
            // Legacy upgrades fail earlier, before storage.initialize().
            console.error('Unable to create the automatic v2 backup:', error);
        }
        
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
        window.addEventListener('portal-atlas-data-changed', () => {
            driveSync.notifyDataChanged();
            if (remoteRenderScheduled) return;
            remoteRenderScheduled = true;
            requestAnimationFrame(async () => {
                remoteRenderScheduled = false;
                await renderWrappers();
            });
        });

        window.addEventListener('portal-atlas-drive-images-changed', () => {
            if (remoteRenderScheduled) return;
            remoteRenderScheduled = true;
            requestAnimationFrame(async () => {
                remoteRenderScheduled = false;
                await renderWrappers();
            });
        });

    } catch (error) {
        console.error('Error initializing:', error);
    }
});
