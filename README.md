# YahaBaby Bookmarks

YahaBaby Bookmarks is a browser extension + React app for saving, organizing, and cleaning up bookmarks.

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Run the web app in dev mode:

```bash
npm run dev
```

## Build Extension (Base)

Build the extension bundle into `dist/`:

```bash
npm run build
```

## Load Into Chrome Extensions

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this project’s `dist` folder:
   `/Users/abdul/Src/bookmarkmaster/dist`
5. Pin/use the extension from the toolbar.

## Update Extension After Code Changes

1. Rebuild:

```bash
npm run build
```

2. Go to `chrome://extensions`.
3. Click the **Reload** button on YahaBaby Bookmarks.

## Notes

- `public/manifest.json` is copied into `dist/manifest.json` during build.
- For extension testing, always load/reload the `dist` directory, not `src`.
- Browser-specific manifests live in `manifests/`.

## Tester Packages

Use browser-specific tester packages only:

```bash
npm run package:browsers
```

This creates zip files in `browser-packages/` (one per browser target).

## Build For Multiple Browsers

Build browser-specific extension folders:

```bash
npm run build:browsers
```

Outputs:

- `dist-browsers/chrome`
- `dist-browsers/edge`
- `dist-browsers/opera`
- `dist-browsers/firefox`
- `dist-browsers/safari`

Package all browser builds as zips:

```bash
npm run package:browsers
```

Outputs:

- `browser-packages/YahaBaby-Bookmarks-chrome.zip`
- `browser-packages/YahaBaby-Bookmarks-edge.zip`
- `browser-packages/YahaBaby-Bookmarks-opera.zip`
- `browser-packages/YahaBaby-Bookmarks-firefox.zip`
- `browser-packages/YahaBaby-Bookmarks-safari.zip`

## Safari Note

Safari distribution normally uses Apple’s conversion/signing flow:

```bash
xcrun safari-web-extension-converter /Users/abdul/Src/bookmarkmaster/dist-browsers/safari --project-location /Users/abdul/Src/bookmarkmaster/safari
```

Then open the generated Xcode project to sign and run/publish.
