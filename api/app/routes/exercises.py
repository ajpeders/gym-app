"""Exercise catalog: search, custom CRUD."""
from __future__ import annotations

import os
import shutil
import uuid as uuid_lib

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Exercise, User
from ..schemas import ExerciseCreate, ExerciseListOut, ExerciseOut, ExerciseUpdate
from ..security import get_current_user

router = APIRouter(prefix="/exercises", tags=["exercises"])


def _visible(user: User):
    """Global seed exercises (owner_id NULL) plus the user's own customs."""
    return or_(Exercise.owner_id.is_(None), Exercise.owner_id == user.id)


@router.get("", response_model=ExerciseListOut)
def list_exercises(
    q: str | None = None,
    muscle: str | None = None,
    equipment: str | None = None,
    category: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExerciseListOut:
    stmt = select(Exercise).where(_visible(user))
    if q:
        stmt = stmt.where(Exercise.name.ilike(f"%{q}%"))
    if equipment:
        stmt = stmt.where(func.lower(Exercise.equipment) == equipment.lower())
    if category:
        stmt = stmt.where(func.lower(Exercise.category) == category.lower())
    if muscle:
        like = f'%"{muscle.lower()}"%'
        stmt = stmt.where(
            or_(
                func.lower(Exercise.primary_muscles).like(like),
                func.lower(Exercise.secondary_muscles).like(like),
            )
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Exercise.name).offset(offset).limit(limit)
    ).all()
    return ExerciseListOut(
        items=[ExerciseOut.model_validate(r) for r in rows], total=total
    )


@router.get("/{exercise_id}", response_model=ExerciseOut)
def get_exercise(
    exercise_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExerciseOut:
    ex = db.scalar(
        select(Exercise).where(Exercise.id == exercise_id, _visible(user))
    )
    if ex is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found")
    return ExerciseOut.model_validate(ex)


@router.post("", response_model=ExerciseOut, status_code=status.HTTP_201_CREATED)
def create_exercise(
    payload: ExerciseCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExerciseOut:
    ex = Exercise(
        name=payload.name,
        category=payload.category,
        equipment=payload.equipment,
        force=payload.force,
        level=payload.level,
        mechanic=payload.mechanic,
        primary_muscles=payload.primary_muscles,
        secondary_muscles=payload.secondary_muscles,
        instructions=payload.instructions,
        images=payload.images,
        is_custom=True,
        owner_id=user.id,
    )
    db.add(ex)
    db.commit()
    db.refresh(ex)
    return ExerciseOut.model_validate(ex)


def _owned_custom(db: Session, exercise_id: int, user: User) -> Exercise:
    ex = db.get(Exercise, exercise_id)
    if ex is None or not ex.is_custom or ex.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom exercise not found",
        )
    return ex


@router.patch("/{exercise_id}", response_model=ExerciseOut)
def update_exercise(
    exercise_id: int,
    payload: ExerciseUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExerciseOut:
    ex = _owned_custom(db, exercise_id, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(ex, field, value)
    db.commit()
    db.refresh(ex)
    return ExerciseOut.model_validate(ex)


@router.delete("/{exercise_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(
    exercise_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ex = _owned_custom(db, exercise_id, user)
    db.delete(ex)
    db.commit()


# --- images on your own exercises ------------------------------------------
#
# 40% of the catalog has no picture, and the importer turns anything it can't
# match into a custom exercise — so the movements most likely to be blank are
# the ones a user just brought in. Only your own exercises can be given an
# image: the shared catalog stays as imported, exactly as the import path
# already promises.
#
# Files land in the same `exercise-media` tree the wger mirror uses, so the
# existing public media route serves them and every <Image> in the app renders
# them with no client change. That route is unauthenticated by design (see its
# docstring); a uuid-named directory keeps paths unguessable and the whole API
# sits behind Traefik's local-only allowlist.

_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_MAX_IMAGE_BYTES = 12 * 1024 * 1024  # 12 MB, matching progress photos


def _media_root() -> str:
    return os.path.join(get_settings().data_dir.rstrip("/"), "exercise-media")


def _drop_uploaded_images(ex: Exercise) -> None:
    """Remove media directories this exercise's own uploads created.

    Only ever touches `exercise-media/<uuid>/` directories we minted for this
    exercise, so a custom exercise pointed at a catalog image (or an external
    URL) never deletes shared files.
    """
    root = os.path.realpath(_media_root())
    for url in ex.images or []:
        parts = url.strip("/").split("/")
        # /api/exercise-media/<uuid>/<file>
        if len(parts) != 4 or parts[:2] != ["api", "exercise-media"]:
            continue
        target = os.path.realpath(os.path.join(root, parts[2]))
        if target.startswith(root + os.sep) and os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)


@router.post("/{exercise_id}/image", response_model=ExerciseOut)
async def upload_exercise_image(
    exercise_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExerciseOut:
    """Replace this exercise's image. One picture per exercise — a gym demo
    shot, not a gallery — so a second upload supersedes the first."""
    ex = _owned_custom(db, exercise_id, user)

    ext = _IMAGE_TYPES.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status_code=400, detail="Unsupported image type")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 12 MB)")

    _drop_uploaded_images(ex)
    folder = uuid_lib.uuid4().hex
    directory = os.path.join(_media_root(), folder)
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, f"image{ext}"), "wb") as fh:
        fh.write(data)

    ex.images = [f"/api/exercise-media/{folder}/image{ext}"]
    db.commit()
    db.refresh(ex)
    return ExerciseOut.model_validate(ex)


@router.delete("/{exercise_id}/image", response_model=ExerciseOut)
def delete_exercise_image(
    exercise_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ExerciseOut:
    ex = _owned_custom(db, exercise_id, user)
    _drop_uploaded_images(ex)
    ex.images = []
    db.commit()
    db.refresh(ex)
    return ExerciseOut.model_validate(ex)
