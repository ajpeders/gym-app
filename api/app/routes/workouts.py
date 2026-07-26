"""Workout (plan day — scheduled template) CRUD."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..models import Exercise, User, Workout, WorkoutExercise
from ..schemas import WorkoutCreate, WorkoutExerciseIn, WorkoutOut, WorkoutUpdate
from ..security import get_current_user

router = APIRouter(prefix="/workouts", tags=["workouts"])


def _get_owned(db: SASession, workout_id: int, user: User) -> Workout:
    workout = db.scalar(
        select(Workout).where(Workout.id == workout_id, Workout.owner_id == user.id)
    )
    if workout is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workout not found")
    return workout


def _validate_exercise(db: SASession, exercise_id: int, user: User):
    ex = db.get(Exercise, exercise_id)
    if ex is None or (ex.owner_id is not None and ex.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exercise_id {exercise_id}",
        )


def _build_workout_exercises(
    db: SASession, items: list[WorkoutExerciseIn], user: User
) -> list[WorkoutExercise]:
    result = []
    for item in items:
        _validate_exercise(db, item.exercise_id, user)
        result.append(
            WorkoutExercise(
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


@router.get("", response_model=list[WorkoutOut])
def list_workouts(
    db: SASession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[WorkoutOut]:
    rows = db.scalars(
        select(Workout).where(Workout.owner_id == user.id).order_by(Workout.created_at.desc())
    ).all()
    return [WorkoutOut.model_validate(w) for w in rows]


@router.post("", response_model=WorkoutOut, status_code=status.HTTP_201_CREATED)
def create_workout(
    payload: WorkoutCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    workout = Workout(
        owner_id=user.id,
        name=payload.name,
        notes=payload.notes,
        split_id=payload.split_id,
        weekdays=payload.weekdays,
        floating=payload.floating,
        order=payload.order,
    )
    workout.exercises = _build_workout_exercises(db, payload.exercises, user)
    db.add(workout)
    db.commit()
    db.refresh(workout)
    return WorkoutOut.model_validate(workout)


@router.get("/{workout_id}", response_model=WorkoutOut)
def get_workout(
    workout_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    return WorkoutOut.model_validate(_get_owned(db, workout_id, user))


@router.patch("/{workout_id}", response_model=WorkoutOut)
def update_workout(
    workout_id: int,
    payload: WorkoutUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkoutOut:
    workout = _get_owned(db, workout_id, user)
    data = payload.model_dump(exclude_unset=True)
    exercises = data.pop("exercises", None)
    for field, value in data.items():
        setattr(workout, field, value)
    if exercises is not None:
        workout.exercises = _build_workout_exercises(db, payload.exercises, user)
    db.commit()
    db.refresh(workout)
    return WorkoutOut.model_validate(workout)


@router.delete("/{workout_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workout(
    workout_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.delete(_get_owned(db, workout_id, user))
    db.commit()
