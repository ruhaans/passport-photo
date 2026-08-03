"""Identity-preserving, background-segmentation service."""

from __future__ import annotations

from io import BytesIO
from threading import Lock

from PIL import Image
from rembg import new_session, remove


class BackgroundRemovalService:
    """Remove a background without resizing or enhancing the source image.

    The rembg model session is created once and guarded by a lock. This avoids
    duplicate model allocations and keeps concurrent requests safe on a small
    CPU deployment. No face, colour, lighting, or detail enhancement occurs.
    """

    def __init__(self) -> None:
        self._session = None
        self._lock = Lock()

    def remove_background(self, source_bytes: bytes) -> bytes:
        """Return a same-resolution RGBA PNG with only the background removed."""
        with Image.open(BytesIO(source_bytes)) as source:
            source.load()
            original_size = source.size

            with self._lock:
                # Download/load the model on the first actual removal request,
                # not during FastAPI startup. The health endpoint and server
                # can therefore become available immediately.
                if self._session is None:
                    self._session = new_session("u2net")

                # rembg performs segmentation only. alpha_matting stays
                # disabled to avoid foreground colour estimation.
                result = remove(source, session=self._session, alpha_matting=False)

        output = result.convert("RGBA")
        if output.size != original_size:
            raise RuntimeError("Background removal changed the image dimensions.")

        buffer = BytesIO()
        output.save(buffer, format="PNG")
        return buffer.getvalue()
