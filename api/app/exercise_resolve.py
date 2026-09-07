"""Turn free-text movement names into exercise ids, creating what's missing.

Shared by the two importers — a plan (`/splits/import`) and logged history
(`/sessions/import`) — because both face the same problem: the file names a
movement, the catalog may or may not have it, and whatever happens the shared
catalog must not be written to. An unmatched movement always becomes an
exercise *you* own.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import Exercise, User


def norm(name: str) -> str:
    """Compare names the way a person would: case- and spacing-insensitive."""
    return " ".join((name or "").split()).strip().lower()


def resolve_custom_names(
    db: Session, user: User, names: list[str]
) -> tuple[dict[str, int], int, int]:
    """Map each name to an owned exercise id. Returns (by-normalised-name, created, reused).

    Reuses one of the user's own exercises when the name already exists rather
    than minting a near-duplicate on every re-import — the thing that left two
    "Cable Face Pull"s behind before.
    """
    wanted = {norm(n): (n or "").strip() for n in names if (n or "").strip()}
    if not wanted:
        return {}, 0, 0

    existing = {
        norm(row.name): row.id
        for row in db.scalars(select(Exercise).where(Exercise.owner_id == user.id)).all()
    }
    resolved: dict[str, int] = {}
    created = reused = 0
    for key, display in wanted.items():
        found = existing.get(key)
        if found is not None:
            resolved[key] = found
            reused += 1
            continue
        row = Exercise(name=display, is_custom=True, owner_id=user.id)
        db.add(row)
        db.flush()  # need the id inside this transaction
        resolved[key] = row.id
        existing[key] = row.id
        created += 1
    return resolved, created, reused


def validate_visible(db: Session, user: User, ids: set[int]) -> None:
    """Reject an id the caller can't see, before anything is written."""
    ids = {i for i in ids if i}
    if not ids:
        return
    visible = {
        row.id
        for row in db.scalars(
            select(Exercise).where(
                Exercise.id.in_(ids),
                or_(Exercise.owner_id.is_(None), Exercise.owner_id == user.id),
            )
        ).all()
    }
    missing = sorted(ids - visible)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown exercise_id {missing[0]}",
        )
