// Function to configure Settings modal
function setupSettingsModal() {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPopup = document.getElementById('popup-form-settings');
    const closeSettingsPopup = document.getElementById('close-popup-settings');

    settingsBtn.addEventListener('click', () => {
        settingsPopup.style.display = 'block';
        updateDriveSettingsUI();
    });

    closeSettingsPopup.addEventListener('click', () => {
        settingsPopup.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === settingsPopup) {
            settingsPopup.style.display = 'none';
        }
    });

    document.getElementById('drive-connect-btn').addEventListener('click', async () => {
        try {
            await driveSync.connect();
        } catch (error) {
            console.error('Unable to connect Google Drive:', error);
            alert(window.i18n.translate(error.code === 'DRIVE_NOT_CONFIGURED'
                ? 'drive_not_configured_detail'
                : 'drive_connect_error'));
        }
        updateDriveSettingsUI();
    });

    document.getElementById('drive-sync-btn').addEventListener('click', async () => {
        try {
            await driveSync.syncAll();
        } catch (error) {
            console.error('Unable to synchronize Google Drive:', error);
        }
        updateDriveSettingsUI();
    });

    document.getElementById('drive-disconnect-btn').addEventListener('click', async () => {
        if (!window.confirm(window.i18n.translate('drive_disconnect_confirm'))) return;
        await driveSync.disconnect();
        updateDriveSettingsUI();
    });

    window.addEventListener('portal-atlas-drive-status', updateDriveSettingsUI);
}

function updateDriveSettingsUI() {
    if (typeof driveSync === 'undefined') return;
    const state = driveSync.getState();
    const connectButton = document.getElementById('drive-connect-btn');
    const syncButton = document.getElementById('drive-sync-btn');
    const disconnectButton = document.getElementById('drive-disconnect-btn');
    const configNote = document.getElementById('drive-config-note');
    const statusText = document.getElementById('drive-status-text');
    const statusDetail = document.getElementById('drive-status-detail');
    const statusDot = document.getElementById('drive-status-dot');
    const progress = document.getElementById('drive-progress');
    const progressBar = document.getElementById('drive-progress-bar');
    if (!connectButton) return;

    configNote.hidden = state.configured;
    connectButton.hidden = state.enabled;
    syncButton.hidden = !state.enabled;
    disconnectButton.hidden = !state.enabled;
    const busy = ['connecting', 'syncing'].includes(state.status);
    connectButton.disabled = busy || !state.configured || !state.online;
    syncButton.disabled = busy || !state.online;
    disconnectButton.disabled = busy;

    const statusKeys = {
        disconnected: ['drive_status_disconnected', 'drive_status_disconnected_detail', ''],
        connecting: ['drive_status_connecting', 'drive_status_connecting_detail', 'busy'],
        idle: ['drive_status_connected', 'drive_status_connected_detail', 'connected'],
        syncing: ['drive_status_syncing', 'drive_status_syncing_detail', 'busy'],
        synced: ['drive_status_synced', 'drive_status_synced_detail', 'connected'],
        offline: ['drive_status_offline', 'drive_status_offline_detail', 'warning'],
        authorization_required: ['drive_status_authorization', 'drive_status_authorization_detail', 'warning'],
        error: ['drive_status_error', 'drive_status_error_detail', 'error']
    };
    const [titleKey, detailKey, dotClass] = statusKeys[state.status] || statusKeys.disconnected;
    statusText.textContent = window.i18n.translate(titleKey);
    let detail = window.i18n.translate(detailKey);
    if (state.status === 'synced' && state.lastSyncAt) {
        detail = window.i18n.translate('drive_last_sync', [
            new Date(state.lastSyncAt).toLocaleString(window.i18n.currentLanguage)
        ]);
    } else if (state.status === 'error' && state.lastError) {
        detail = state.lastError;
    }
    statusDetail.textContent = detail;
    statusDot.className = `drive-status-dot ${dotClass}`.trim();

    progress.hidden = state.status !== 'syncing';
    const percentage = state.progressTotal > 0
        ? Math.round((state.progressDone / state.progressTotal) * 100)
        : 8;
    progressBar.style.width = `${percentage}%`;
}
