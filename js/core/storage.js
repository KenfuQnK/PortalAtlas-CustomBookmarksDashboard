const storage = {
    async isStorageEmpty() {
        const cards = await this.get(CONFIG.STORAGE_KEYS.CARDS);
        const wrappers = await this.get(CONFIG.STORAGE_KEYS.WRAPPERS);
        const isEmpty = (!cards || cards.length === 0) && (!wrappers || wrappers.length === 0);
        
        if (isEmpty) {
            await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, -1);
        }
        
        return isEmpty;
    },

    async initializeDefaultData() {
        const isFirstTime = await this.isStorageEmpty();
        // If storage is empty at the first time, initialize default cards so user has a starting layout proposal example
        if (isFirstTime) {
            await this.set(CONFIG.STORAGE_KEYS.WRAPPERS, DEFAULT_DATA.wrappers);
            await this.set(CONFIG.STORAGE_KEYS.CARDS, DEFAULT_DATA.cards);
            
            let initialHighest = -1;
            DEFAULT_DATA.cards.forEach(card => {
                const match = card.id.match(/^default-card-(\d+)$/);
                if (match) {
                    initialHighest = Math.max(initialHighest, parseInt(match[1]));
                }
            });
            await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, initialHighest);
            return true;
        }
        
        try {
            const existingCards = await this.get(CONFIG.STORAGE_KEYS.CARDS);
            const defaultCardPattern = /^default-card-(\d+)$/;
            
            let highestDefaultNum = await this.get(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM);
            if (highestDefaultNum === undefined || highestDefaultNum === null) {
                highestDefaultNum = -1;
                existingCards.forEach(card => {
                    const match = card.id.match(defaultCardPattern);
                    if (match) {
                        const num = parseInt(match[1]);
                        highestDefaultNum = Math.max(highestDefaultNum, num);
                    }
                });
                await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, highestDefaultNum);
            }

            let maxNewDefaultNum = -1;
            DEFAULT_DATA.cards.forEach(card => {
                const match = card.id.match(defaultCardPattern);
                if (match) {
                    const num = parseInt(match[1]);
                    maxNewDefaultNum = Math.max(maxNewDefaultNum, num);
                }
            });

            if (maxNewDefaultNum > highestDefaultNum) {
                const newDefaultCards = DEFAULT_DATA.cards.filter(defaultCard => {
                    const match = defaultCard.id.match(defaultCardPattern);
                    if (match) {
                        const num = parseInt(match[1]);
                        return num > highestDefaultNum;
                    }
                    return false;
                });
                
                if (newDefaultCards.length > 0) {
                    const wrappers = await this.get(CONFIG.STORAGE_KEYS.WRAPPERS);
                    const mainWrapper = wrappers.find(w => w.order === 0);
                    
                    if (!mainWrapper) {
                        console.warn('Main wrapper not found');
                        return false;
                    }
                    
                    const modifiedCards = existingCards.concat(
                        newDefaultCards.map(card => ({
                            ...card,
                            wrapperId: mainWrapper.id,
                            order: existingCards.length + newDefaultCards.indexOf(card)
                        }))
                    );
                    
                    await this.set(CONFIG.STORAGE_KEYS.CARDS, modifiedCards);
                    await this.set(CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM, maxNewDefaultNum);
                    return true;
                }
            }
        } catch (error) {
            console.error('Error managing new default cards:', error);
        }
        
        return false;
    },

    // If image is included in data, use local storage (as it supports bigger memory)
    async set(key, data) {
        if (key === CONFIG.STORAGE_KEYS.CARDS || key === CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM) {
            return new Promise((resolve, reject) => {
                chrome.storage.local.set({ [key]: data }, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        }
        // For the rest of the data use sync storage
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [key]: data }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    },

    async get(key) {
        // If image is included in data, use local storage (as it supports bigger memory)
        if (key === CONFIG.STORAGE_KEYS.CARDS || key === CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM) {
            return new Promise((resolve, reject) => {
                chrome.storage.local.get([key], (result) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(result[key] || (key === CONFIG.STORAGE_KEYS.HIGHEST_DEFAULT_NUM ? -1 : []));
                    }
                });
            });
        }
        // For the rest of the data use sync storage
        return new Promise((resolve, reject) => {
            chrome.storage.sync.get([key], (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(result[key] || []);
                }
            });
        });
    }
};