"""Avatar upload and serving endpoint."""

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/avatar", tags=["avatar"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE = 2 * 1024 * 1024  # 2 MB

EXTENSION_MAP = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _avatars_dir() -> Path:
    d = settings.data_dir / "uploads" / "avatars"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("")
async def upload_avatar(file: UploadFile = File(...)) -> dict[str, str]:
    """Upload an avatar image. Returns the serving URL."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type}. Use JPG, PNG, or WebP.",
        )

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="Image must be 2 MB or smaller.")

    ext = EXTENSION_MAP[file.content_type]
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = _avatars_dir() / filename
    dest.write_bytes(content)

    logger.info("Avatar uploaded: %s (%d bytes)", filename, len(content))
    return {"url": f"/api/v1/avatar/{filename}"}


@router.get("/{filename}")
async def serve_avatar(filename: str) -> FileResponse:
    """Serve an uploaded avatar image."""
    # Sanitize: only allow simple filenames, no path traversal
    safe = Path(filename).name
    if safe != filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    path = _avatars_dir() / safe
    if not path.exists():
        logger.warning("Avatar not found on disk: %s (resolved: %s)", filename, path)
        raise HTTPException(status_code=404, detail="Avatar not found.")

    media_type = "image/jpeg"
    if safe.endswith(".png"):
        media_type = "image/png"
    elif safe.endswith(".webp"):
        media_type = "image/webp"

    logger.info("Serving avatar: %s (%s)", safe, media_type)
    return FileResponse(path, media_type=media_type)
