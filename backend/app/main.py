from __future__ import annotations

import os
from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

from app.services.background_removal import BackgroundRemovalService

ALLOWED_FORMATS = {"JPEG", "PNG"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}

app = FastAPI(title="Passport Photo Background Removal API")

cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)

background_removal_service = BackgroundRemovalService()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/background/remove", response_class=Response)
async def remove_background(file: UploadFile = File(...)) -> Response:
    """Segment the background from a JPG/JPEG/PNG and return transparent PNG."""
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, JPEG, or PNG image.")

    source_bytes = await file.read()
    if not source_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")

    try:
        with Image.open(BytesIO(source_bytes)) as image:
            if image.format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=415, detail="Upload a JPG, JPEG, or PNG image.")
            image.verify()
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=415, detail="Upload a valid image file.") from error

    try:
        transparent_png = await run_in_threadpool(
            background_removal_service.remove_background, source_bytes
        )
    except Exception as error:
        # Do not expose model or filesystem details to clients.
        raise HTTPException(status_code=500, detail="Background removal could not be completed.") from error

    return Response(
        content=transparent_png,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )
