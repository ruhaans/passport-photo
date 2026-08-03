# Passport Photo Sheet Builder

Create passport, visa, Aadhaar, PAN, and ID photo sheets. The React editor keeps crop, zoom, rotation, border, spacing, layout, PNG, and PDF generation in the browser. Optional background removal is performed by a separate FastAPI service using `rembg`; it only segments the background and does not enhance or generate image content.

## Run locally

Use two terminals. Requires Node.js 20+ and Python 3.10+.

```sh
# Terminal 1: API
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

On macOS/Linux, activate the virtual environment with `source .venv/bin/activate`.

```sh
# Terminal 2: React app (from the repository root)
npm install
npm run dev
```

Vite proxies `POST /api/background/remove` to `http://127.0.0.1:8000` by default. The first `rembg` use downloads its model; later requests use the loaded model. CPU processing time depends on the source resolution and machine, so under-three-second processing cannot be guaranteed for unusually large photos.

## Background removal API

`POST /api/background/remove` accepts a JPG, JPEG, or PNG in a `file` form field and returns a same-resolution transparent PNG. `BackgroundRemovalService` is the only backend implementation point. It uses one model session and serializes model inference to avoid concurrent model allocations on CPU.

The frontend calls only this HTTP endpoint through `src/services/backgroundRemoval.ts`. It composites returned transparency onto pure white (`#FFFFFF`) at the original dimensions, then passes the result to the existing editor. If the API is unavailable or fails, it keeps the original upload and displays a non-blocking notification.

## Deploy the frontend to GitHub Pages

GitHub Pages can host the static React app but cannot run FastAPI. Deploy `backend/` to a Python-compatible host, then:

1. Configure its `CORS_ORIGINS` environment variable with your GitHub Pages origin, for example `https://your-user.github.io`.
2. In your GitHub repository, create an Actions variable named `BACKGROUND_REMOVAL_API_URL` with the API origin, for example `https://photos-api.example.com` (no trailing slash).
3. Enable **Settings → Pages → GitHub Actions** and push to `main`.

The Pages workflow injects that variable into the Vite build. If it is not set, the deployed app retains normal photo-sheet functionality and uses the original upload whenever background removal cannot reach an API.
