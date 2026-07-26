"""Split (weekly plan) CRUD — a plan owns several day-workouts + rules."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..models import Session, Split, User, Workout
from ..schemas import SplitCreate, SplitOut, SplitUpdate, TodayWorkout
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
    now = datetime.now(timezone.utc)
    weekday = (now.weekday() + 1) % 7  # 0=Sun..6=Sat
    active = db.scalar(select(Split).where(Split.owner_id == user.id, Split.is_active.is_(True)))
    if active is None:
        return []
    return [TodayWorkout(id=w.id, name=w.name, floating=w.floating, weekdays=w.weekdays,
                         done_this_week=_done_this_week(db, user.id, w.id, now))
            for w in active.workouts if weekday in (w.weekdays or [])]


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
