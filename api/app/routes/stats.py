"""Basic training statistics."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..models import (
    Exercise,
    Session,
    SessionExercise,
    SetEntry,
    User,
)
from ..schemas import StatsSummary
from ..security import get_current_user

router = APIRouter(prefix="/stats", tags=["stats"])


def _week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


@router.get("/summary", response_model=StatsSummary)
def summary(
    db: SASession = Depends(get_db), user: User = Depends(get_current_user)
) -> StatsSummary:
    workouts = db.scalars(
        select(Session).where(Session.owner_id == user.id)
    ).all()
    total_workouts = len(workouts)

    now = datetime.now(timezone.utc)
    # rolling 7-day volume window — intentionally NOT the split's Sunday-based "done this week"
    week_ago = now - timedelta(days=7)

    def _aware(dt: datetime) -> datetime:
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    this_week = sum(1 for w in workouts if _aware(w.started_at) >= week_ago)

    # Current streak: consecutive calendar days (ending today or yesterday) with a workout.
    today = now.date()
    dates = sorted({_aware(w.started_at).date() for w in workouts}, reverse=True)
    streak = 0
    if dates and (today - dates[0]).days <= 1:
        streak = 1
        prev = dates[0]
        for d in dates[1:]:
            delta = (prev - d).days
            if delta == 0:
                continue
            if delta == 1:
                streak += 1
                prev = d
            else:
                break

    # Volume per week (sum of reps * weight across completed sets).
    rows = db.execute(
        select(
            Session.started_at,
            SetEntry.reps,
            SetEntry.weight,
            Exercise.name,
            SetEntry.completed_at,
        )
        .join(SessionExercise, SessionExercise.session_id == Session.id)
        .join(SetEntry, SetEntry.session_exercise_id == SessionExercise.id)
        .join(Exercise, Exercise.id == SessionExercise.exercise_id)
        .where(Session.owner_id == user.id, SetEntry.completed.is_(True))
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
        streak=streak,
        recent_prs=recent_prs,
        volume_by_week=volume_list,
    )
