"""Exercise catalog: search, custom CRUD."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

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
