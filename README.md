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

PNG exports include 300 DPI density metadata. Print the generated PNG at
**100% / Actual size**, not “Fit to page”, to preserve physical dimensions.
