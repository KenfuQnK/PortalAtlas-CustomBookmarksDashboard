# Portal Atlas
## _Custom Bookmarks Dashboard Chrome Extension_

**Portal Atlas**  
Transform your new tab into a powerful, **customizable** dashboard for quick access to your favorite websites.  
Portal Atlas is a Chrome extension that replaces the default new tab page with a visually appealing, highly personalized bookmarking system.

## ✨ Key Features

- Quick access to your most-used websites
- Create custom cards to save your favourite bookmarks
- Intuitive drag-and-drop interface

## 📚 Organization

- Create sections to group related bookmarks
- Drag and drop cards or sections to reorganize them
- Expand/collapse sections for better overview
- Easily move cards between sections

## 🎨 Visual Bookmarking

- Create visually appealing cards with custom background images
- Choose from three different card sizes: small, wide, and large
- Customize background colors and image positioning
- Clean, modern design

## 🔧 Customization Options

- Adjust background image size and position
- Fine-tune image positioning with directional controls
- Set custom background colors
- Configure card sizes to your preference
- Choose whether to display card titles

## 🌍 Multilingual Support

Available in multiple languages:
- English
- Español
- Français
- Deutsch

## 💾 Data Management

- Automatic Chrome Sync for cards, sections and settings
- Optimized local image storage with lazy loading
- Optional private Google Drive image backup and cross-device recovery
- Offline image cache with a fast preview and a sharper display copy
- Export your layout for backup
- Import layout to restore or transfer your setup

## 🚀 Benefits

- **Increased Productivity:** Quick access to your most important websites
- **Visual Organization:** Easy recognition of bookmarks through visual cues  
- **Personalization:** Make your new tab page truly yours  
- **Cross-device Sync:** Keep cards, sections, order and URL images consistent across Chrome devices
- **Optional Drive Images:** Link Google Drive to recover uploaded images on other devices without making an account mandatory
- **Backup & Restore:** Transfer the complete dashboard, including local images, in one backup file

## 📱 Usage

1. Install the extension from the Chrome Web Store
2. Open a new tab to access your dashboard
3. Click the top right button to add new cards
4. Create sections to organize your bookmarks
5. Edit cards or sections with right click to open a user friendly interface
6. Drag and drop items to arrange your perfect layout


**Transform your browsing experience with Portal Atlas - where functionality meets creativity on your new tab page.**


_Privacy note: Portal Atlas has no developer-operated backend, analytics, or advertising. Metadata is kept locally and, when Chrome Sync is enabled, synchronized by Chrome; remote card images are requested from the source selected by the user. If the user explicitly connects Google Drive, optimized image copies are stored privately in that user's `appDataFolder`. See `privacidad de datos.md` for the complete data-handling description._

## Permission rationale

- `<all_urls>` is intentional and required by the core feature that lets users fetch and cache a card image from any URL they choose. Portal Atlas does not inject scripts into those sites or read their page content.
- `identity` authorizes the optional Google Drive integration.
- `storage` and `unlimitedStorage` keep dashboard metadata and user-selected images available locally.

The definitive storage rules for previews, high-quality copies, Google Drive, and backups are documented in `ARQUITECTURA_IMAGENES.md`.

___

Do you love the extension? Do you want to invite me a coffe?
https://paypal.me/JesusCuencaOnecha
