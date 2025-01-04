// Export/Import functions
function setupExportImport() {
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFile = document.getElementById('importFile');

    exportBtn.addEventListener('click', exportData); // Set up event listener for exporting data
    importBtn.addEventListener('click', () => importFile.click()); // Trigger file input click on import button click
    importFile.addEventListener('change', importData); // Set up event listener for file input change
}

async function exportData() {
    const data = {
        cards: await dataManager.getAllCards(), // Fetch all card data
        wrappers: await dataManager.getAllWrappers() // Fetch all wrapper data
    };

    const now = new Date(); // Get the current date and time
    const timestamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0'); // Create a timestamp string

    const dataStr = JSON.stringify(data, null, 2); // Convert data to JSON string format
    const blob = new Blob([dataStr], { type: "application/json" }); // Create a Blob object for the JSON data
    const url = URL.createObjectURL(blob); // Create a URL for the Blob
    const a = document.createElement('a'); // Create an anchor element for downloading
    a.href = url; // Set the href to the Blob URL
    a.download = `PortalAtlas_Backup_${timestamp}.json`; // Set the download filename with timestamp
    a.click(); // Programmatically click the anchor to trigger download
    URL.revokeObjectURL(url); // Release the Blob URL
}

async function importData(event) {
    const file = event.target.files[0]; // Get the selected file from the input
    if (file) {
        const reader = new FileReader(); // Create a FileReader to read the file
        reader.onload = async function(e) {
            try {
                const importedData = JSON.parse(e.target.result); // Parse the JSON data from the file
                
                debug('Imported data:', { // Log the imported data counts for debugging
                    wrappersCount: importedData.wrappers?.length || 0,
                    cardsCount: importedData.cards?.length || 0
                });

                if (importedData.cards && importedData.wrappers) { // Check if the data structure is valid
                    // First, save the cards using chrome.storage.local
                    try {
                        await new Promise((resolve, reject) => {
                            chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.CARDS] : importedData.cards }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error('Error saving cards:', chrome.runtime.lastError); // Log error if saving fails
                                    reject(chrome.runtime.lastError); // Reject the promise on error
                                } else {
                                    resolve(); // Resolve the promise if successful
                                }
                            });
                        });
                        
                        debug('Cards saved successfully'); // Log success message for saving cards

                        // Then, save the wrappers in sync
                        await new Promise((resolve, reject) => {
                            chrome.storage.sync.set({ [CONFIG.STORAGE_KEYS.WRAPPERS] : importedData.wrappers }, () => {
                                if (chrome.runtime.lastError) {
                                    console.error('Error saving wrappers:', chrome.runtime.lastError); // Log error if saving fails
                                    reject(chrome.runtime.lastError); // Reject the promise on error
                                } else {
                                    resolve(); // Resolve the promise if successful
                                }
                            });
                        });

                        debug('Wrappers saved successfully'); // Log success message for saving wrappers
                        
                        await renderWrappers(); // Render the wrappers after saving
                        alert('Data imported successfully'); // Alert user of successful import
                    } catch (error) {
                        console.error('Error during import:', error); // Log any errors during the import process
                        alert('Error saving imported data: ' + error.message); // Alert user of the error
                    }
                } else {
                    alert('Invalid file format'); // Alert user if the file format is invalid
                }
            } catch (error) {
                console.error('Error reading JSON:', error); // Log error if JSON parsing fails
                alert('Error reading the JSON file'); // Alert user of the error
            }
        };
        reader.readAsText(file); // Read the file as text
    }
}
