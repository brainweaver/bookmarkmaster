# BookmarkMaster

BookmarkMaster is a Chrome Extension + React app for saving, organizing, and cleaning up bookmarks.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Run the web app in dev mode:

```bash
npm run dev
```

## Build Extension

Build the extension bundle into `dist/`:

```bash
npm run build
```

## Load Into Chrome Extensions

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this project’s `dist` folder:
   `/Users/abdul/Src/BookmarkMaster/dist`
5. Pin/use the extension from the toolbar.

## Update Extension After Code Changes

1. Rebuild:

```bash
npm run build
```

2. Go to `chrome://extensions`.
3. Click the **Reload** button on BookmarkMaster.

## Notes

- `public/manifest.json` is copied into `dist/manifest.json` during build.
- For extension testing, always load/reload the `dist` directory, not `src`.

## Create Tester Zip

Build and package a shareable zip for local testers:

```bash
npm run package:testers
```

This creates `BookmarkMaster-extension.zip` at the project root.
Testers can extract it and load the `dist` folder via `chrome://extensions` → **Load unpacked**.
