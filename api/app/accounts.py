"""Deleting an account, and cleaning up after ones that were deleted badly.

Two paths delete an account — the owner from Settings and an operator from the
admin view — and they must remove exactly the same rows. A row left behind
isn't merely litter: **SQLite reuses user ids**, so an orphan pointing at a
deleted account's id can be silently adopted by the next person to sign up.
That is the whole reason this lives in one place instead of being written twice.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from .models import (
    AthleteProfile,
    CoachMessage,
    Exercise,
    NutritionEntry,
    ProgressPhoto,
    ReadinessCheck,
    Split,
    User,
    Workout,
)

logger = logging.getLogger("gym.accounts")

# Everything owned by a user that the `User` relationships don't already
# cascade. Settings, sessions (and their exercises/sets) and body metrics come
# off the relationship cascade; these are joined only by an id column.
_OWNED = [
    (Workout, "owner_id"),
    (Split, "owner_id"),
    (ProgressPhoto, "owner_id"),
    (CoachMessage, "user_id"),
    (AthleteProfile, "user_id"),
    (NutritionEntry, "owner_id"),
    (ReadinessCheck, "owner_id"),
    # Custom exercises go; the shared catalog (owner_id NULL) is untouched.
    (Exercise, "owner_id"),
]


def purge_user(db: SASession, user: User) -> None:
    """Delete a user and everything they own, in one place for both callers."""
    uid = user.id
    for model, column in _OWNED:
        for row in db.scalars(select(model).where(getattr(model, column) == uid)):
            db.delete(row)
    db.delete(user)
    db.commit()


def sweep_orphans(db: SASession) -> int:
    """Delete rows belonging to users that no longer exist.

    Defence against exactly the failure above, including any left by an older
    version of the delete path — the alternative is a new account inheriting a
    stranger's training the first time it opens History. Runs at boot; returns
    how many rows it removed so the count can be logged rather than silent.
    """
    from .models import BodyMetric, Session, Settings

    live = {row for row in db.scalars(select(User.id))}
    removed = 0
    for model, column in [*_OWNED, (Session, "owner_id"), (BodyMetric, "owner_id"),
                          (Settings, "user_id")]:
        for row in db.scalars(select(model)):
            owner = getattr(row, column)
            if owner is not None and owner not in live:
                db.delete(row)
                removed += 1
    if removed:
        db.commit()
        logger.warning("removed %s orphaned rows belonging to deleted accounts", removed)
    return removed
