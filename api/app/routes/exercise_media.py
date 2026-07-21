"""Serve mirrored exercise-catalog images (from the wger import).

Public (no auth): this is CC-BY-SA catalog imagery, not user-private data, and
the whole API already sits behind Traefik's local-only allowlist. Kept separate
from the authed exercise CRUD so <Image> can load it with a plain URL.
"""
from __future__ import annotations

import os
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import get_settings

router = APIRouter(prefix="/exercise-media", tags=["exercise-media"])

_UUID_RE = re.compile(r"^[0-9a-fA-F-]{8,64}$")
_FILE_RE = re.compile(r"^[0-9A-Za-z._-]{1,64}$")
_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


@router.get("/{uuid}/{filename}")
def get_exercise_image(uuid: str, filename: str) -> FileResponse:
    # Strict validation guards against path traversal.
    if not _UUID_RE.match(uuid) or not _FILE_RE.match(filename) or ".." in filename:
        raise HTTPException(status_code=400, detail="Bad path")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _TYPES:
        raise HTTPException(status_code=400, detail="Unsupported type")
    root = os.path.join(get_settings().data_dir.rstrip("/"), "exercise-media")
    path = os.path.realpath(os.path.join(root, uuid, filename))
    # Ensure the resolved path stays within the media root.
    if not path.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type=_TYPES[ext])
