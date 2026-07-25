"""Routine (workout template) CRUD."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Exercise, Routine, RoutineExercise, User
from ..schemas import RoutineCreate, RoutineExerciseIn, RoutineOut, RoutineUpdate
from ..security import get_current_user

router = APIRouter(prefix="/routines", tags=["routines"])


def _get_owned(db: Session, routine_id: int, user: User) -> Routine:
    routine = db.scalar(
        select(Routine).where(Routine.id == routine_id, Routine.owner_id == user.id)
    )
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found")
    return routine


def _validate_exercise(db: Session, exercise_id: int, user: User):
    ex = db.get(Exercise, exercise_id)
    if ex is None or (ex.owner_id is not None and ex.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exercise_id {exercise_id}",
        )


def _build_routine_exercises(
    db: Session, items: list[RoutineExerciseIn], user: User
) -> list[RoutineExercise]:
    result = []
    for item in items:
        _validate_exercise(db, item.exercise_id, user)
        result.append(
            RoutineExercise(
                exercise_id=item.exercise_id,
                order=item.order,
                target_sets=item.target_sets,
                target_reps=item.target_reps,
                target_reps_max=item.target_reps_max,
                target_weight=item.target_weight,
                rest_seconds=item.rest_seconds,
                notes=item.notes,
            )
        )
    return result


@router.get("", response_model=list[RoutineOut])
def list_routines(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[RoutineOut]:
    rows = db.scalars(
        select(Routine).where(Routine.owner_id == user.id).order_by(Routine.created_at.desc())
    ).all()
    return [RoutineOut.model_validate(r) for r in rows]


@router.post("", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
def create_routine(
    payload: RoutineCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoutineOut:
    routine = Routine(
        owner_id=user.id,
        name=payload.name,
        notes=payload.notes,
        split_id=payload.split_id,
        day_label=payload.day_label,
        day_order=payload.day_order,
    )
    routine.exercises = _build_routine_exercises(db, payload.exercises, user)
    db.add(routine)
    db.commit()
    db.refresh(routine)
    return RoutineOut.model_validate(routine)


@router.get("/{routine_id}", response_model=RoutineOut)
def get_routine(
    routine_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoutineOut:
    return RoutineOut.model_validate(_get_owned(db, routine_id, user))


@router.patch("/{routine_id}", response_model=RoutineOut)
def update_routine(
    routine_id: int,
    payload: RoutineUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoutineOut:
    routine = _get_owned(db, routine_id, user)
    if payload.name is not None:
        routine.name = payload.name
    if payload.notes is not None:
        routine.notes = payload.notes
    if payload.split_id is not None:
        routine.split_id = payload.split_id
    if payload.day_label is not None:
        routine.day_label = payload.day_label
    if payload.day_order is not None:
        routine.day_order = payload.day_order
    if payload.exercises is not None:
        routine.exercises = _build_routine_exercises(db, payload.exercises, user)
    db.commit()
    db.refresh(routine)
    return RoutineOut.model_validate(routine)


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(
    routine_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.delete(_get_owned(db, routine_id, user))
    db.commit()
