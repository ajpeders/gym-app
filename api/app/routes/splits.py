"""Split (weekly plan) CRUD — a plan owns several day-workouts + rules."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..models import Session, Split, User, Workout
from ..schemas import (
    CatchupDay,
    CatchupSession,
    CatchupWorkout,
    SplitCreate,
    SplitOut,
    SplitUpdate,
    TodayWorkout,
)
from ..security import get_current_user

router = APIRouter(prefix="/splits", tags=["splits"])


def _get_owned(db: SASession, split_id: int, user: User) -> Split:
    split = db.scalar(select(Split).where(Split.id == split_id, Split.owner_id == user.id))
    if split is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Split not found")
    return split


@router.get("", response_model=list[SplitOut])
def list_splits(
    db: SASession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[SplitOut]:
    rows = db.scalars(
        select(Split)
        .where(Split.owner_id == user.id)
        .order_by(Split.is_active.desc(), Split.created_at.desc())
    ).all()
    return [SplitOut.model_validate(s) for s in rows]


@router.post("", response_model=SplitOut, status_code=status.HTTP_201_CREATED)
def create_split(
    payload: SplitCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SplitOut:
    split = Split(
        owner_id=user.id,
        name=payload.name,
        rules=payload.rules,
        notes=payload.notes,
    )
    db.add(split)
    db.commit()
    db.refresh(split)
    return SplitOut.model_validate(split)


def _week_start(now: datetime) -> datetime:
    # Sunday 00:00 UTC (sessions store started_at in UTC; no per-user tz tracked).
    days_since_sun = (now.weekday() + 1) % 7
    return (now - timedelta(days=days_since_sun)).replace(hour=0, minute=0, second=0, microsecond=0)


def _done_this_week(db: SASession, user_id: int, workout_id: int, now: datetime) -> bool:
    return db.scalar(select(Session.id).where(
        Session.owner_id == user_id,
        Session.source_workout_id == workout_id,
        Session.started_at >= _week_start(now),
    ).limit(1)) is not None


@router.get("/today", response_model=list[TodayWorkout])
def today(db: SASession = Depends(get_db), user: User = Depends(get_current_user)):
    """What the athlete could train right now, from the active split.

    Returns three kinds of day, distinguished by flags rather than by being
    filtered out, so a rest day still has something to offer:

    * ``scheduled_today`` — today's weekday claims it.
    * ``missed`` — scheduled earlier this week and not yet done: a makeup.
    * floating — pinned to no weekday, so always available. These used to be
      dropped entirely, since a floating day has empty ``weekdays`` and the
      old filter asked whether today was in that empty list.

    Days still upcoming later this week are omitted — they aren't due yet.
    """
    now = datetime.now(timezone.utc)
    weekday = (now.weekday() + 1) % 7  # 0=Sun..6=Sat
    active = db.scalar(select(Split).where(Split.owner_id == user.id, Split.is_active.is_(True)))
    if active is None:
        return []

    rows: list[TodayWorkout] = []
    for w in active.workouts:
        weekdays = w.weekdays or []
        scheduled_today = weekday in weekdays
        done = _done_this_week(db, user.id, w.id, now)
        # Earlier this week and never done — offer it as a makeup. "Earlier"
        # means every weekday it claims has already passed, so a day pinned to
        # both Friday and Saturday isn't missed until Saturday is behind us.
        missed = (
            not scheduled_today
            and not w.floating
            and bool(weekdays)
            and max(weekdays) < weekday
            and not done
        )
        if not (scheduled_today or missed or w.floating):
            continue
        rows.append(
            TodayWorkout(
                id=w.id,
                name=w.name,
                floating=w.floating,
                weekdays=weekdays,
                done_this_week=done,
                scheduled_today=scheduled_today,
                missed=missed,
            )
        )
    return rows


@router.get("/catchup", response_model=list[CatchupDay])
def catchup(
    days: int = 14,
    tz_offset: int = 0,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CatchupDay]:
    """The recent past day by day, so an unlogged backlog is visible.

    ``/today`` answers "what now"; this answers "what did I miss". Each day
    carries what the active split scheduled for that weekday and any sessions
    actually logged, most recent first.

    ``tz_offset`` follows JS ``getTimezoneOffset()`` — minutes to ADD to local
    time to reach UTC (UTC-6 sends 360). Sessions are stored naive UTC, so
    bucketing them by UTC date would file an evening session under the next
    day for anyone west of UTC.
    """
    days = max(1, min(days, 60))
    shift = timedelta(minutes=tz_offset)
    now_local = datetime.now(timezone.utc).replace(tzinfo=None) - shift
    today_local = now_local.date()
    oldest_local = today_local - timedelta(days=days - 1)

    # Widen the fetch by a day on each side: a local day straddles two UTC ones.
    rows = db.scalars(
        select(Session)
        .where(
            Session.owner_id == user.id,
            Session.started_at >= datetime.combine(oldest_local, datetime.min.time()) + shift - timedelta(days=1),
            Session.started_at < datetime.combine(today_local, datetime.min.time()) + shift + timedelta(days=2),
        )
        .order_by(Session.started_at)
    ).all()

    by_date: dict[str, list[CatchupSession]] = {}
    for s in rows:
        local_day = (s.started_at - shift).date().isoformat()
        by_date.setdefault(local_day, []).append(
            CatchupSession(id=s.id, name=s.name, exercise_count=len(s.exercises))
        )

    active = db.scalar(select(Split).where(Split.owner_id == user.id, Split.is_active.is_(True)))
    scheduled_by_weekday: dict[int, list[CatchupWorkout]] = {}
    if active is not None:
        for w in active.workouts:
            for wd in w.weekdays or []:
                scheduled_by_weekday.setdefault(wd, []).append(
                    CatchupWorkout(id=w.id, name=w.name)
                )

    out: list[CatchupDay] = []
    for i in range(days):
        d = today_local - timedelta(days=i)
        key = d.isoformat()
        weekday = (d.weekday() + 1) % 7  # 0=Sun..6=Sat
        sessions = by_date.get(key, [])
        out.append(
            CatchupDay(
                date=key,
                weekday=weekday,
                scheduled=scheduled_by_weekday.get(weekday, []),
                sessions=sessions,
                logged=bool(sessions),
            )
        )
    return out


@router.get("/{split_id}", response_model=SplitOut)
def get_split(
    split_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SplitOut:
    return SplitOut.model_validate(_get_owned(db, split_id, user))


@router.patch("/{split_id}", response_model=SplitOut)
def update_split(
    split_id: int,
    payload: SplitUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SplitOut:
    split = _get_owned(db, split_id, user)
    if payload.name is not None:
        split.name = payload.name
    if payload.rules is not None:
        split.rules = payload.rules
    if payload.notes is not None:
        split.notes = payload.notes
    if payload.is_active is not None:
        if payload.is_active:
            # Only one active split per user.
            for other in db.scalars(
                select(Split).where(Split.owner_id == user.id, Split.id != split.id)
            ):
                other.is_active = False
        split.is_active = payload.is_active
    db.commit()
    db.refresh(split)
    return SplitOut.model_validate(split)


@router.delete("/{split_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_split(
    split_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    split = _get_owned(db, split_id, user)
    # Detach day-workouts (SET NULL) so they survive as standalone workouts.
    for w in db.scalars(select(Workout).where(Workout.split_id == split.id)):
        w.split_id = None
    db.delete(split)
    db.commit()
