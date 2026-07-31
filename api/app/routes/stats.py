"""Basic training statistics."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from typing import Annotated

from fastapi import APIRouter, Depends, Query
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
from ..schemas import ExerciseStats, StatsSummary
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


@router.get("/exercises", response_model=list[ExerciseStats])
def exercise_stats(
    exercise_ids: Annotated[list[int], Query()] = [],
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ExerciseStats]:
    """Personal records for specific exercises, batched for one workout's worth.

    Only the caller's own completed sets count. Weight-based figures ignore
    sets logged without a load (bodyweight work), so an unweighted set can't
    pull min_weight down to nothing, while set_count and max_reps still see
    every set.
    """
    if not exercise_ids:
        return []
    wanted = list(dict.fromkeys(exercise_ids))  # de-dupe, keep request order

    rows = db.execute(
        select(
            SessionExercise.exercise_id,
            SetEntry.reps,
            SetEntry.weight,
            SetEntry.completed_at,
            Session.started_at,
        )
        .join(SessionExercise, SessionExercise.session_id == Session.id)
        .join(SetEntry, SetEntry.session_exercise_id == SessionExercise.id)
        .where(
            Session.owner_id == user.id,
            SetEntry.completed.is_(True),
            SessionExercise.exercise_id.in_(wanted),
        )
    ).all()

    acc: dict[int, dict] = {ex_id: {"sets": 0} for ex_id in wanted}
    for ex_id, reps, weight, completed_at, started_at in rows:
        a = acc[ex_id]
        a["sets"] += 1
        when = completed_at or started_at
        if when is not None:
            prev = a.get("last")
            if prev is None or when > prev:
                a["last"] = when
        if reps is not None and reps > (a.get("max_reps") or 0):
            a["max_reps"] = reps
        if weight is None:
            continue
        if a.get("min_w") is None or weight < a["min_w"]:
            a["min_w"] = weight
        # Ties go to the rep-richer set: same load for more reps is the better lift.
        if (
            a.get("max_w") is None
            or weight > a["max_w"]
            or (weight == a["max_w"] and (reps or 0) > (a.get("best_reps") or 0))
        ):
            a["max_w"] = weight
            a["best_reps"] = reps
            a["best_at"] = when

    return [
        ExerciseStats(
            exercise_id=ex_id,
            best_weight=a.get("max_w"),
            best_weight_reps=a.get("best_reps"),
            best_weight_at=a.get("best_at"),
            min_weight=a.get("min_w"),
            max_weight=a.get("max_w"),
            max_reps=a.get("max_reps"),
            set_count=a["sets"],
            last_performed_at=a.get("last"),
        )
        for ex_id, a in ((i, acc[i]) for i in wanted)
    ]
