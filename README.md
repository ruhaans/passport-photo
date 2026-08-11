# Passport Photo Sheet Builder

Create 35 x 45 mm passport-photo sheets at 300 DPI in a Vite application.

The editor keeps manual crop, zoom, position, rotation, cutting guides,
spacing, sheet layouts, and PNG export. It does not use AI, face detection,
automatic crop/alignment, or a backend.

## Run locally

```sh
npm install
npm run dev
```

## Verify

```sh
npm run typecheck
npm run lint
npm run build
```

## Deploy to GitHub Pages

The app builds into static files and deploys through the included GitHub Pages
workflow. No API keys or secrets are required.

## Print or share

**Print / Share PNG** opens the device share sheet on mobile, where you can
choose your printer app. On desktop, it opens the browser print dialog with the
sheet at its intended physical size. The browser and printer app still control
the selected printer, paper, and print settings; choose **Actual size** rather
than **Fit to page**.

PNG exports include 300 DPI density metadata. Print the generated PNG at
**100% / Actual size**, not “Fit to page”, to preserve physical dimensions.
