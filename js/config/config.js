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
        // The preview stays deliberately small for fast first paint. This
        // larger derivative is the offline/Drive copy used once available.
        QUALITY_MAX_DIMENSION: 1600,
        QUALITY_WEBP_QUALITY: 0.9,
        LOAD_CONCURRENCY: 4,
        LAZY_ROOT_MARGIN: '300px',
        // A cached URL image is immediately usable. Revalidate periodically
        // so remote changes arrive without contacting every image host on
        // every new tab opening.
        REMOTE_REVALIDATE_MS: 7 * 24 * 60 * 60 * 1000
    },
    SYNC: {
        QUOTA_BYTES: 102400,
        QUOTA_BYTES_PER_ITEM: 8192,
        MAX_ITEMS: 512,
        SAFE_TOTAL_BYTES: 96 * 1024
    },
    DRIVE: {
        STATE_KEY: 'pa:drive-state',
        ENABLED_SYNC_KEY: 'pa:drive-enabled',
        SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
        API_ROOT: 'https://www.googleapis.com/drive/v3',
        UPLOAD_ROOT: 'https://www.googleapis.com/upload/drive/v3',
        FILE_PREFIX: 'portal-atlas-'
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
