"""Workout sessions, their exercises, and logged sets."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Exercise,
    Routine,
    SetEntry,
    User,
    Workout,
    WorkoutExercise,
    utcnow,
)
from ..schemas import (
    SetCreate,
    SetOut,
    SetUpdate,
    WorkoutCreate,
    WorkoutExerciseCreate,
    WorkoutExerciseOut,
    WorkoutListOut,
    WorkoutOut,
    WorkoutStart,
    WorkoutUpdate,
)
from ..security import get_current_user

router = APIRouter(prefix="/workouts", tags=["workouts"])


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _get_workout(db: Session, workout_id: int, user: User) -> Workout:
    w = db.scalar(
        select(Workout).where(Workout.id == workout_id, Workout.owner_id == user.id)
    )
    if w is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workout not found")
    return w


def _get_workout_exercise(
    db: Session, workout: Workout, we_id: int
) -> WorkoutExercise:
    we = db.get(WorkoutExercise, we_id)
    if we is None or we.workout_id != workout.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Workout exercise not found"
        )
    return we


def _validate_exercise(db: Session, exercise_id: int, user: User) -> Exercise:
    ex = db.get(Exercise, exercise_id)
    if ex is None or (ex.owner_id is not None and ex.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exercise_id {exercise_id}",
        )
    return ex


# --------------------------------------------------------------------------
# Workout lifecycle
# --------------------------------------------------------------------------
@router.get("", response_model=WorkoutListOut)
def list_workouts(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutListOut:
    base = select(Workout).where(Workout.owner_id == user.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(Workout.started_at.desc()).offset(offset).limit(limit)
    ).all()
    return WorkoutListOut(
        items=[WorkoutOut.model_validate(w) for w in rows], total=total
    )


def _resolve_started_at(value: datetime | None) -> datetime:
    """A caller-supplied date backdates the session; naive input is treated as
    UTC to match utcnow(). Omitted -> now."""
    if value is None:
        return utcnow()
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


@router.post("/start", response_model=WorkoutOut, status_code=status.HTTP_201_CREATED)
def start_workout(
    payload: WorkoutStart,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    workout = Workout(
        owner_id=user.id,
        name=payload.name,
        started_at=_resolve_started_at(payload.started_at),
        finished_at=None,
        source_routine_id=payload.routine_id,
    )
    if payload.routine_id is not None:
        routine = db.scalar(
            select(Routine).where(
                Routine.id == payload.routine_id, Routine.owner_id == user.id
            )
        )
        if routine is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found"
            )
        if not workout.name:
            workout.name = routine.name
        for re in routine.exercises:
            workout.exercises.append(
                WorkoutExercise(exercise_id=re.exercise_id, order=re.order, notes=re.notes)
            )
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return WorkoutOut.model_validate(workout)


@router.post("", response_model=WorkoutOut, status_code=status.HTTP_201_CREATED)
def create_workout(
    payload: WorkoutCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    workout = Workout(
        owner_id=user.id, name=payload.name, started_at=_resolve_started_at(payload.started_at)
    )
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return WorkoutOut.model_validate(workout)


@router.get("/{workout_id}", response_model=WorkoutOut)
def get_workout(
    workout_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return WorkoutOut.model_validate(_get_workout(db, workout_id, user))


@router.patch("/{workout_id}", response_model=WorkoutOut)
def update_workout(
    workout_id: int,
    payload: WorkoutUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    workout = _get_workout(db, workout_id, user)
    if payload.name is not None:
        workout.name = payload.name
    if payload.notes is not None:
        workout.notes = payload.notes
    db.commit()
    db.refresh(workout)
    return WorkoutOut.model_validate(workout)


@router.post("/{workout_id}/finish", response_model=WorkoutOut)
def finish_workout(
    workout_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    workout = _get_workout(db, workout_id, user)
    workout.finished_at = utcnow()
    db.commit()
    db.refresh(workout)
    return WorkoutOut.model_validate(workout)


@router.delete("/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workout(
    workout_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.delete(_get_workout(db, workout_id, user))
    db.commit()


# --------------------------------------------------------------------------
# Workout exercises
# --------------------------------------------------------------------------
@router.post(
    "/{workout_id}/exercises",
    response_model=WorkoutExerciseOut,
    status_code=status.HTTP_201_CREATED,
)
def add_workout_exercise(
    workout_id: int,
    payload: WorkoutExerciseCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutExerciseOut:
    workout = _get_workout(db, workout_id, user)
    _validate_exercise(db, payload.exercise_id, user)
    order = payload.order
    if order is None:
        order = (
            db.scalar(
                select(func.coalesce(func.max(WorkoutExercise.order), -1)).where(
                    WorkoutExercise.workout_id == workout.id
                )
            )
            + 1
        )
    we = WorkoutExercise(
        workout_id=workout.id, exercise_id=payload.exercise_id, order=order
    )
    db.add(we)
    db.commit()
    db.refresh(we)
    return WorkoutExerciseOut.model_validate(we)


@router.delete(
    "/{workout_id}/exercises/{we_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_workout_exercise(
    workout_id: int,
    we_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workout = _get_workout(db, workout_id, user)
    we = _get_workout_exercise(db, workout, we_id)
    db.delete(we)
    db.commit()


# --------------------------------------------------------------------------
# Sets
# --------------------------------------------------------------------------
@router.post(
    "/{workout_id}/exercises/{we_id}/sets",
    response_model=SetOut,
    status_code=status.HTTP_201_CREATED,
)
def add_set(
    workout_id: int,
    we_id: int,
    payload: SetCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SetOut:
    workout = _get_workout(db, workout_id, user)
    we = _get_workout_exercise(db, workout, we_id)
    set_number = payload.set_number
    if set_number is None:
        set_number = (
            db.scalar(
                select(func.coalesce(func.max(SetEntry.set_number), 0)).where(
                    SetEntry.workout_exercise_id == we.id
                )
            )
            + 1
        )
    entry = SetEntry(
        workout_exercise_id=we.id,
        set_number=set_number,
        reps=payload.reps,
        weight=payload.weight,
        rpe=payload.rpe,
        set_type=payload.set_type,
        completed=payload.completed,
        completed_at=utcnow() if payload.completed else None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return SetOut.model_validate(entry)


def _get_set(db: Session, workout: Workout, we_id: int, set_id: int) -> SetEntry:
    we = _get_workout_exercise(db, workout, we_id)
    entry = db.get(SetEntry, set_id)
    if entry is None or entry.workout_exercise_id != we.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Set not found")
    return entry


@router.patch(
    "/{workout_id}/exercises/{we_id}/sets/{set_id}", response_model=SetOut
)
def update_set(
    workout_id: int,
    we_id: int,
    set_id: int,
    payload: SetUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SetOut:
    workout = _get_workout(db, workout_id, user)
    entry = _get_set(db, workout, we_id, set_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(entry, field, value)
    if "completed" in data:
        entry.completed_at = utcnow() if entry.completed else None
    db.commit()
    db.refresh(entry)
    return SetOut.model_validate(entry)


@router.delete(
    "/{workout_id}/exercises/{we_id}/sets/{set_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_set(
    workout_id: int,
    we_id: int,
    set_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    workout = _get_workout(db, workout_id, user)
    entry = _get_set(db, workout, we_id, set_id)
    db.delete(entry)
    db.commit()
