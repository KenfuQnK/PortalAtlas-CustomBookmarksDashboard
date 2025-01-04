const dataManager = {
    // Card Management
    async saveCard(cardData) {
        const cards = await storage.get(CONFIG.STORAGE_KEYS.CARDS); // Retrieve existing cards from storage
        const existingCardIndex = cards.findIndex(card => card.id === cardData.id); // Find the index of the existing card by ID
        
        if (existingCardIndex !== -1) {
            // Here we need to maintain the original order
            const originalOrder = cards[existingCardIndex].order; // Preserve the original order of the card
            cards[existingCardIndex] = {
                ...cardData,
                order: originalOrder // Assign the original order to the updated card
            };
        } else {
            // For new cards, assign the last order
            const maxOrder = Math.max(...cards.map(card => card.order || 0), -1); // Determine the maximum order value
            cards.push({
                ...cardData,
                order: maxOrder + 1 // Assign the next order value for the new card
            });
        }
        
        await storage.set(CONFIG.STORAGE_KEYS.CARDS, cards); // Save the updated cards back to storage
    },

    async deleteCard(cardId) {
        const cards = await storage.get(CONFIG.STORAGE_KEYS.CARDS); // Retrieve existing cards from storage
        const filteredCards = cards.filter(card => card.id !== cardId); // Filter out the card to be deleted
        await storage.set(CONFIG.STORAGE_KEYS.CARDS, filteredCards); // Save the remaining cards back to storage
    },

    async getAllCards() {
        return await storage.get(CONFIG.STORAGE_KEYS.CARDS); // Retrieve all cards from storage
    },

    // Wrapper Management
    async saveWrapper(wrapperData) {
        const wrappers = await storage.get(CONFIG.STORAGE_KEYS.WRAPPERS); // Retrieve existing wrappers from storage
        const existingWrapperIndex = wrappers.findIndex(wrapper => wrapper.id === wrapperData.id); // Find the index of the existing wrapper by ID
        
        if (existingWrapperIndex !== -1) {
            wrappers[existingWrapperIndex] = wrapperData; // Update the existing wrapper with new data
        } else {
            wrappers.push(wrapperData); // Add the new wrapper to the list
        }
        
        await storage.set(CONFIG.STORAGE_KEYS.WRAPPERS, wrappers); // Save the updated wrappers back to storage
    },

    async getAllWrappers() {
        return await storage.get(CONFIG.STORAGE_KEYS.WRAPPERS); // Retrieve all wrappers from storage
    },

    // Wrapper State Management
    async saveWrapperStates(states) {
        await storage.set(CONFIG.STORAGE_KEYS.WRAPPER_STATES, states); // Save the wrapper states to storage
    },

    async getWrapperStates() {
        return await storage.get(CONFIG.STORAGE_KEYS.WRAPPER_STATES) || {}; // Retrieve wrapper states or return an empty object
    },

    // Delete the wrapper
    async deleteWrapper(wrapperId) {
        const wrappers = await storage.get(CONFIG.STORAGE_KEYS.WRAPPERS); // Retrieve existing wrappers from storage
        const filteredWrappers = wrappers.filter(wrapper => wrapper.id !== wrapperId); // Filter out the wrapper to be deleted
        await storage.set(CONFIG.STORAGE_KEYS.WRAPPERS, filteredWrappers); // Save the remaining wrappers back to storage
    
        // Delete all cards associated with this wrapper
        const cards = await storage.get(CONFIG.STORAGE_KEYS.CARDS); // Retrieve existing cards from storage
        const filteredCards = cards.filter(card => card.wrapperId !== wrapperId); // Filter out cards associated with the deleted wrapper
        await storage.set(CONFIG.STORAGE_KEYS.CARDS, filteredCards); // Save the remaining cards back to storage
    },

    // Order Management
    async updateCardOrder(wrapperId, cardIds) {
        const cards = await storage.get(CONFIG.STORAGE_KEYS.CARDS); // Retrieve existing cards from storage
        const updatedCards = cards.map(card => ({
            ...card,
            order: cardIds.indexOf(card.id), // Update the order based on the new card IDs
            wrapperId: card.wrapperId === wrapperId ? wrapperId : card.wrapperId // Maintain the wrapper ID if it matches
        }));
        
        await storage.set(CONFIG.STORAGE_KEYS.CARDS, updatedCards); // Save the updated cards back to storage
    },

    async updateWrapperOrder(wrapperIds) {
        const wrappers = await storage.get(CONFIG.STORAGE_KEYS.WRAPPERS); // Retrieve existing wrappers from storage
        const updatedWrappers = wrappers.map(wrapper => ({
            ...wrapper,
            order: wrapperIds.indexOf(wrapper.id) 
        }));
        
        await storage.set(CONFIG.STORAGE_KEYS.WRAPPERS, updatedWrappers); // Save the updated wrappers back to storage
    },
};
