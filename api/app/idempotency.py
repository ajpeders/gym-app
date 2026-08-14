"""Make the writes the offline queue can replay safe to replay.

`lib/offline.ts` retries anything it couldn't confirm. "Couldn't confirm"
includes the case where the server committed and the response was lost on the
way back — so a retry is not always a first attempt. For a plain set that meant
a duplicate row; once starting and finishing a workout are queued too it means
a replayed start trips the single-active-session guard and closes the workout
the user is standing in.

A client that wants protection sends `Idempotency-Key`. Nothing changes for one
that doesn't.
"""
from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Optional

from fastapi import Header
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as SASession

from .models import IdempotentWrite, User


def idempotency_key(
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
) -> Optional[str]:
    """FastAPI dependency reading the header. Blank counts as absent."""
    key = (idempotency_key or "").strip()
    return key or None


def replay_or_run(
    db: SASession,
    user: User,
    key: Optional[str],
    run: Callable[[], Any],
    dump: Callable[[Any], Any],
) -> Any:
    """Return the remembered answer for `key`, or run the write and remember it.

    `dump` turns the handler's return value into JSON-able form; the stored
    copy is replayed verbatim so the second response matches the first.

    Only successes are recorded. A rejected write must stay retryable — the
    client may be about to send a corrected version under the same key.
    """
    if key is None:
        return run()

    seen = db.scalar(
        select(IdempotentWrite).where(
            IdempotentWrite.owner_id == user.id, IdempotentWrite.key == key
        )
    )
    if seen is not None:
        return json.loads(seen.response)

    result = run()
    db.add(
        IdempotentWrite(
            owner_id=user.id, key=key, response=json.dumps(dump(result), default=str)
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Two replays landed at once; the other one won. Roll back to its answer
        # rather than returning a second, different object.
        db.rollback()
        winner = db.scalar(
            select(IdempotentWrite).where(
                IdempotentWrite.owner_id == user.id, IdempotentWrite.key == key
            )
        )
        if winner is not None:
            return json.loads(winner.response)
        raise
    return result
