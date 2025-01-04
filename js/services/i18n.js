// lang/i18n.js
window.i18n = {
    currentLanguage: 'es',
    translations: {},
    fallbackLanguage: 'en',

    async init() {
        try {
            // Intentar cargar el idioma guardado
            const saved = await this.getSavedLanguage();

            if (saved) {
                this.currentLanguage = saved;
            } else {
                // Detectar idioma del navegador
                const browserLang = navigator.language.split('-')[0];
                this.currentLanguage = this.isLanguageSupported(browserLang) ? browserLang : this.fallbackLanguage;
            }

            // Cargar las traducciones del idioma seleccionado
            await this.loadTranslations(this.currentLanguage);
            
            // Actualizar el selector de idioma si existe
            const languageSelector = document.getElementById('language-selector');
            if (languageSelector) {
                languageSelector.value = this.currentLanguage;
            }

            // Actualizar la UI con las traducciones
            this.updateUI();

        } catch (error) {
            console.error('Error en la inicialización de i18n:', error);
        }
    },

    async getSavedLanguage() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['language'], (result) => {
                resolve(result.language);
            });
        });
    },

    isLanguageSupported(lang) {
        return ['en', 'es', 'fr', 'de'].includes(lang);
    },

    async loadTranslations(lang) {
        try {
            const response = await fetch(chrome.runtime.getURL(`lang/${lang}.json`));
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.translations = await response.json();
        } catch (error) {
            console.error(`Error loading translations for ${lang}:`, error);
            if (lang !== this.fallbackLanguage) {
                await this.loadTranslations(this.fallbackLanguage);
            }
        }
    },

    async setLanguage(lang) {
        try {
            if (this.isLanguageSupported(lang)) {
                this.currentLanguage = lang;
                await this.loadTranslations(lang);
                
                // Guardar la preferencia
                await new Promise((resolve, reject) => {
                    chrome.storage.sync.set({ language: lang }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('Error guardando idioma:', chrome.runtime.lastError);
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve();
                        }
                    });
                });
                
                this.updateUI();
            }
        } catch (error) {
            console.error('Error al cambiar el idioma:', error);
        }
    },

    translate(key, params = []) {
        let text = this.translations[key] || key;
        params.forEach((param, index) => {
            text = text.replace(`{${index}}`, param);
        });
        return text;
    },

    updateUI() {
        // Actualizar elementos con data-i18n
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            element.textContent = this.translate(key);
        });

        // Actualizar placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            element.placeholder = this.translate(key);
        });

        // Actualizar títulos
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            element.title = this.translate(key);
        });
    }
};