"""How today feels — the manual half of recovery.

The fields mirror what a wearable reports (sleep, resting heart rate, HRV) plus
the two things only the athlete can say (soreness, energy). Same shape either
way, so wiring a watch up later fills these rows instead of the form and
nothing downstream changes.

Advisory, never a gate: the app does not get to tell someone they may not
train.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session as SASession

from .. import analysis
from ..db import get_db
from ..models import ReadinessCheck, User
from ..schemas import ReadinessCheckIn, ReadinessOut
from ..security import get_current_user

router = APIRouter(prefix="/readiness", tags=["readiness"])


def _out(row: ReadinessCheck) -> ReadinessOut:
    reading = analysis.daily_readiness(row.sleep_hours, row.soreness, row.energy)
    return ReadinessOut(
        **{
            "id": row.id,
            "day": row.day,
            "sleep_hours": row.sleep_hours,
            "soreness": row.soreness,
            "energy": row.energy,
            "resting_hr": row.resting_hr,
            "hrv_ms": row.hrv_ms,
            "notes": row.notes,
        },
        score=reading["score"] if reading else None,
        status=reading["status"] if reading else None,
        advice=reading["advice"] if reading else None,
    )


@router.get("", response_model=list[ReadinessOut])
def list_checks(
    days: int = Query(default=14, ge=1, le=365),
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ReadinessOut]:
    """Recent check-ins, newest first."""
    since = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    rows = db.scalars(
        select(ReadinessCheck)
        .where(ReadinessCheck.owner_id == user.id, ReadinessCheck.day >= since)
        .order_by(ReadinessCheck.day.desc())
    ).all()
    return [_out(r) for r in rows]


@router.post("", response_model=ReadinessOut, status_code=status.HTTP_201_CREATED)
def check_in(
    payload: ReadinessCheckIn,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReadinessOut:
    """Record today. Checking in twice updates, rather than stacking two rows —
    you have one morning per day."""
    day = payload.day or date.today().isoformat()
    row = db.scalar(
        select(ReadinessCheck).where(
            ReadinessCheck.owner_id == user.id, ReadinessCheck.day == day
        )
    )
    if row is None:
        row = ReadinessCheck(owner_id=user.id, day=day)
        db.add(row)

    for field in ("sleep_hours", "soreness", "energy", "resting_hr", "hrv_ms", "notes"):
        value = getattr(payload, field)
        if value is not None:
            setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return _out(row)
