const CONFIG = {
    SCHEMA_VERSION: 2,
    STORAGE_KEYS: {
        // Legacy v1 keys. They remain here so existing installations can be
        // migrated without asking users to export/import their dashboard.
        CARDS: 'cards',
        WRAPPERS: 'wrappers',
        WRAPPER_STATES: 'wrapperStates',
        HIGHEST_DEFAULT_NUM: 'highestDefaultNum',

        // V2 keys are deliberately short: chrome.storage.sync counts key
        // names towards both its total quota and its per-item quota.
        V2_SCHEMA: 'pa:v',
        // A compact checksum manifest. Entity/scalar keys are written first
        // and this key is written last, so other devices never activate a
        // partially delivered multi-key snapshot.
        V2_COMMIT: 'pa:m',
        V2_STATES: 'pa:s',
        V2_HIGHEST_DEFAULT_NUM: 'pa:h',
        V2_SYNC_STATUS: 'pa:sync-status',
        V2_MIGRATION_BACKUP: 'pa:v2-backup',
        CARD_PREFIX: 'pa:c:',
        WRAPPER_PREFIX: 'pa:w:'
    },
    MEDIA: {
        DB_NAME: 'portal-atlas-media',
        DB_VERSION: 1,
        STORE_NAME: 'images',
        // The largest card is about 370px at the current responsive
        // breakpoints. 400px keeps enough detail without retaining the
        // multi-megapixel source image.
        MAX_DIMENSION: 400,
        WEBP_QUALITY: 0.8,
        LOAD_CONCURRENCY: 4,
        LAZY_ROOT_MARGIN: '300px'
    },
    SYNC: {
        QUOTA_BYTES: 102400,
        QUOTA_BYTES_PER_ITEM: 8192,
        MAX_ITEMS: 512,
        SAFE_TOTAL_BYTES: 96 * 1024
    },
    DEFAULT_VALUES: {
        ID: '',
        NAME: '',
        LINK: '',
        SIZE: 'card-small',
        BACKGROUND_IMAGE: '',
        BACKGROUND_SIZE: '100%',
        BACKGROUND_COLOR: '#000000',
        BACKGROUND_POSITION: '50,50',
        WRAPPER: '',
        SHOW_NAME: true
    }
};
