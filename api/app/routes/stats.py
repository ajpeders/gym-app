"""Basic training statistics."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Exercise,
    SetEntry,
    User,
    Workout,
    WorkoutExercise,
)
from ..schemas import StatsSummary
from ..security import get_current_user

router = APIRouter(prefix="/stats", tags=["stats"])


def _week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


@router.get("/summary", response_model=StatsSummary)
def summary(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> StatsSummary:
    workouts = db.scalars(
        select(Workout).where(Workout.owner_id == user.id)
    ).all()
    total_workouts = len(workouts)

    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    def _aware(dt: datetime) -> datetime:
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    this_week = sum(1 for w in workouts if _aware(w.started_at) >= week_ago)

    # Volume per week (sum of reps * weight across completed sets).
    rows = db.execute(
        select(
            Workout.started_at,
            SetEntry.reps,
            SetEntry.weight,
            Exercise.name,
            SetEntry.completed_at,
        )
        .join(WorkoutExercise, WorkoutExercise.workout_id == Workout.id)
        .join(SetEntry, SetEntry.workout_exercise_id == WorkoutExercise.id)
        .join(Exercise, Exercise.id == WorkoutExercise.exercise_id)
        .where(Workout.owner_id == user.id, SetEntry.completed.is_(True))
    ).all()

    volume_by_week: dict[str, float] = defaultdict(float)
    best_lift: dict[str, dict] = {}
    for started_at, reps, weight, ex_name, completed_at in rows:
        vol = (reps or 0) * (weight or 0)
        volume_by_week[_week_key(_aware(started_at))] += vol
        if weight is not None:
            cur = best_lift.get(ex_name)
            if cur is None or weight > cur["weight"]:
                best_lift[ex_name] = {
                    "exercise": ex_name,
                    "weight": weight,
                    "reps": reps,
                    "date": (_aware(completed_at).isoformat() if completed_at else None),
                }

    volume_list = [
        {"week": k, "volume": round(v, 2)} for k, v in sorted(volume_by_week.items())
    ]
    recent_prs = sorted(
        best_lift.values(), key=lambda p: p["weight"], reverse=True
    )[:5]

    return StatsSummary(
        total_workouts=total_workouts,
        this_week=this_week,
        recent_prs=recent_prs,
        volume_by_week=volume_list,
    )
