"""Progress photos — physique-tracking pictures attached to a date."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import ProgressPhoto, User
from ..schemas import ProgressPhotoOut
from ..security import get_current_user

router = APIRouter(prefix="/progress-photos", tags=["progress-photos"])

_ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}
_MAX_BYTES = 12 * 1024 * 1024  # 12 MB — generous for a phone photo


def _user_dir(owner_id: int) -> str:
    d = os.path.join(get_settings().uploads_dir, "progress", str(owner_id))
    os.makedirs(d, exist_ok=True)
    return d


def _parse_taken_at(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid taken_at date") from exc
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.get("", response_model=list[ProgressPhotoOut])
def list_photos(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[ProgressPhotoOut]:
    rows = db.scalars(
        select(ProgressPhoto)
        .where(ProgressPhoto.owner_id == user.id)
        .order_by(ProgressPhoto.taken_at.desc(), ProgressPhoto.id.desc())
    ).all()
    return [ProgressPhotoOut.model_validate(r) for r in rows]


@router.post("", response_model=ProgressPhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    file: UploadFile = File(...),
    taken_at: str | None = Form(None),
    notes: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProgressPhotoOut:
    ext = _ALLOWED.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 12 MB)")

    stored = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(_user_dir(user.id), stored)
    with open(path, "wb") as fh:
        fh.write(data)

    photo = ProgressPhoto(
        owner_id=user.id,
        taken_at=_parse_taken_at(taken_at),
        filename=stored,
        content_type=(file.content_type or "image/jpeg").lower(),
        notes=(notes or None),
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return ProgressPhotoOut.model_validate(photo)


def _owned(db: Session, photo_id: int, user: User) -> ProgressPhoto:
    photo = db.scalar(
        select(ProgressPhoto).where(
            ProgressPhoto.id == photo_id, ProgressPhoto.owner_id == user.id
        )
    )
    if photo is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    return photo


@router.get("/{photo_id}/image")
def get_image(
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    photo = _owned(db, photo_id, user)
    path = os.path.join(_user_dir(user.id), photo.filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Image file missing")
    return FileResponse(path, media_type=photo.content_type)


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(
    photo_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    photo = _owned(db, photo_id, user)
    path = os.path.join(_user_dir(user.id), photo.filename)
    db.delete(photo)
    db.commit()
    try:
        os.remove(path)
    except OSError:
        pass  # row is gone; a missing file is harmless
