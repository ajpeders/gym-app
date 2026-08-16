"""Calorie / protein log — timestamped intake entries."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from .. import foods as food_library
from ..models import NutritionEntry, User
from ..schemas import Food, NutritionEntryCreate, NutritionEntryOut, NutritionEntryUpdate
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


@router.get("/foods", response_model=list[Food])
def list_foods(
    q: str = "",
    user: User = Depends(get_current_user),
) -> list[Food]:
    """The common-foods shelf, optionally filtered.

    Curated and small on purpose: the staples are most of what a lifter logs,
    and the long tail of packaged products is a different problem (barcodes, a
    real food API) rather than a bigger list.
    """
    return [Food(**f) for f in food_library.search(q)]


@router.post("", response_model=NutritionEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: NutritionEntryCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NutritionEntryOut:
    label, calories, protein = payload.label, payload.calories, payload.protein
    if payload.food is not None:
        food = food_library.get(payload.food)
        if food is None:
            # Logging an unknown food as zero calories is worse than refusing:
            # it silently makes the day's totals wrong.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown food {payload.food!r}"
            )
        auto_calories, auto_protein, auto_label = food_library.portion(food, payload.amount)
        # The shelf is a convenience, not an authority.
        label = label or auto_label
        calories = calories if calories is not None else auto_calories
        protein = protein if protein is not None else auto_protein

    entry = NutritionEntry(
        owner_id=user.id,
        eaten_at=_resolve_eaten_at(payload.eaten_at),
        label=label,
        calories=calories,
        protein=protein,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return NutritionEntryOut.model_validate(entry)


def _owned(db: SASession, entry_id: int, user: User) -> NutritionEntry:
    entry = db.scalar(
        select(NutritionEntry).where(
            NutritionEntry.id == entry_id, NutritionEntry.owner_id == user.id
        )
    )
    # 404 rather than 403 for someone else's entry — don't confirm it exists.
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@router.patch("/{entry_id}", response_model=NutritionEntryOut)
def update_entry(
    entry_id: int,
    payload: NutritionEntryUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NutritionEntryOut:
    entry = _owned(db, entry_id, user)
    fields = payload.model_dump(exclude_unset=True)
    if "eaten_at" in fields and fields["eaten_at"] is not None:
        fields["eaten_at"] = _resolve_eaten_at(fields["eaten_at"])
    for key, value in fields.items():
        setattr(entry, key, value)
    db.commit()
    db.refresh(entry)
    return NutritionEntryOut.model_validate(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _owned(db, entry_id, user)
    db.delete(entry)
    db.commit()
