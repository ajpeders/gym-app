"""Per-user images for catalog exercises nobody owns.

The upload path only ever writes to a row *you* own (see `models.
ExerciseImageOverride`), so the swap has to happen on the way out — and it has
to happen everywhere an exercise is serialized, not just on the exercise
screen. An exercise is embedded in workouts, in splits, in sessions and in the
account export; patching each of those return sites would work until someone
adds the twenty-first, and then one screen would quietly show the stock photo.

So it's done once, in `ExerciseOut`'s serializer, against a lookup published
here for the duration of a request by the `use_image_overrides` dependency,
which `main.py` attaches to the routers that serialize exercises.

That dependency is deliberately `async def`. A sync dependency runs in a worker
thread with a *copy* of the request's context, so a `ContextVar.set()` inside
one is thrown away when it returns — the override would silently never apply.
An async one runs in the request's own context, and a sync endpoint later reads
it through the copy it inherits.

The lookup is lazy: routes that never serialize an exercise never query for it.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import ExerciseImageOverride, User
from .security import get_current_user


class OverrideLookup:
    """One user's overrides, loaded at most once per request."""

    def __init__(self, db: Session, user_id: int) -> None:
        self._db = db
        self._user_id = user_id
        self._map: Optional[dict[int, list[str]]] = None

    def _load(self) -> dict[int, list[str]]:
        if self._map is None:
            self._map = {
                row.exercise_id: list(row.images or [])
                for row in self._db.scalars(
                    select(ExerciseImageOverride).where(
                        ExerciseImageOverride.owner_id == self._user_id
                    )
                ).all()
            }
        return self._map

    def images_for(self, exercise_id: Optional[int]) -> Optional[list[str]]:
        if exercise_id is None:
            return None
        return self._load().get(exercise_id)

    def forget(self) -> None:
        """Drop the cache after a write, so the response shows the new picture."""
        self._map = None


_current: ContextVar[Optional[OverrideLookup]] = ContextVar(
    "exercise_image_overrides", default=None
)


def publish(db: Session, user_id: int) -> OverrideLookup:
    lookup = OverrideLookup(db, user_id)
    _current.set(lookup)
    return lookup


def current() -> Optional[OverrideLookup]:
    """The lookup for the request in flight, or None outside one."""
    return _current.get()


async def use_image_overrides(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Publish the caller's overrides for this request. Must stay `async` —
    see the module docstring."""
    publish(db, user.id)
