"""Workout (plan day — scheduled template) CRUD."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..models import Exercise, Session, SessionExercise, SetEntry, User, Workout, WorkoutExercise
from ..overload import suggest_next
from ..schemas import (
    OverloadSuggestion,
    WorkoutCreate,
    WorkoutExerciseIn,
    WorkoutOut,
    WorkoutUpdate,
)
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
                target_weight_max=item.target_weight_max,
                target_duration_seconds=item.target_duration_seconds,
                target_duration_seconds_max=item.target_duration_seconds_max,
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


@router.get("/{workout_id}/suggestions", response_model=list[OverloadSuggestion])
def suggestions(
    workout_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[OverloadSuggestion]:
    """What to aim for next time on each exercise in this plan day.

    Derived, never stored: the plan's target plus the most recent session's
    sets for that movement, run through the same rule the progression badge
    uses (`app/overload.py`). Nothing here asks a model — a suggested weight is
    training data, and an invented one is worse than none.
    """
    workout = _get_owned(db, workout_id, user)
    out: list[OverloadSuggestion] = []
    for we in workout.exercises:
        # The last session that actually logged this movement — not the last
        # session, which may have skipped it.
        last_se = db.scalar(
            select(SessionExercise)
            .join(Session, Session.id == SessionExercise.session_id)
            .where(
                Session.owner_id == user.id,
                SessionExercise.exercise_id == we.exercise_id,
            )
            .order_by(Session.started_at.desc(), SessionExercise.id.desc())
            .limit(1)
        )
        sets = (
            [
                {
                    "reps": s.reps,
                    "weight": s.weight,
                    "duration_seconds": s.duration_seconds,
                    "set_type": s.set_type,
                }
                for s in last_se.sets
                if s.completed
            ]
            if last_se is not None
            else []
        )
        exercise = db.get(Exercise, we.exercise_id)
        result = suggest_next(
            {
                "target_sets": we.target_sets,
                "target_reps": we.target_reps,
                "target_reps_max": we.target_reps_max,
                "target_duration_seconds": we.target_duration_seconds,
                "target_duration_seconds_max": we.target_duration_seconds_max,
                "equipment": exercise.equipment if exercise else None,
            },
            sets,
        )
        out.append(
            OverloadSuggestion(
                exercise_id=we.exercise_id,
                exercise_name=exercise.name if exercise else "Exercise",
                **result,
            )
        )
    return out


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
