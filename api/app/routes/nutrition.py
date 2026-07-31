"""Calorie / protein log — timestamped intake entries."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..models import NutritionEntry, User
from ..schemas import NutritionEntryCreate, NutritionEntryOut
from ..security import get_current_user

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


def _resolve_eaten_at(value: datetime | None) -> datetime:
    """Caller-supplied time wins, so a meal logged later keeps when it was
    eaten. Naive input is treated as UTC to match utcnow()."""
    if value is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return value.replace(tzinfo=None) if value.tzinfo is None else value.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("", response_model=list[NutritionEntryOut])
def list_entries(
    days: int = Query(default=14, ge=1, le=365),
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[NutritionEntryOut]:
    """Recent entries, newest first.

    Deliberately returns a flat window rather than per-day totals: the client
    groups by local calendar day, and no per-user timezone is stored here.
    The window is widened by a day so a client in any timezone still sees
    everything belonging to its own oldest day.
    """
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days + 1)
    rows = db.scalars(
        select(NutritionEntry)
        .where(NutritionEntry.owner_id == user.id, NutritionEntry.eaten_at >= since)
        .order_by(NutritionEntry.eaten_at.desc())
    ).all()
    return [NutritionEntryOut.model_validate(r) for r in rows]


@router.post("", response_model=NutritionEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: NutritionEntryCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NutritionEntryOut:
    entry = NutritionEntry(
        owner_id=user.id,
        eaten_at=_resolve_eaten_at(payload.eaten_at),
        label=payload.label,
        calories=payload.calories,
        protein=payload.protein,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return NutritionEntryOut.model_validate(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = db.scalar(
        select(NutritionEntry).where(
            NutritionEntry.id == entry_id, NutritionEntry.owner_id == user.id
        )
    )
    # 404 rather than 403 for someone else's entry — don't confirm it exists.
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(entry)
    db.commit()
