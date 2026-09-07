"""Body metrics tracking — the weight history behind every trend."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BodyMetric, User
from ..schemas import BodyMetricCreate, BodyMetricOut
from ..security import get_current_user

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("", response_model=list[BodyMetricOut])
def list_metrics(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[BodyMetricOut]:
    rows = db.scalars(
        select(BodyMetric)
        .where(BodyMetric.owner_id == user.id)
        .order_by(BodyMetric.recorded_at.desc())
    ).all()
    return [BodyMetricOut.model_validate(r) for r in rows]


def _resolve_recorded_at(value: datetime | None) -> datetime:
    """Caller-supplied time wins, so a weigh-in filled in later keeps the day it
    happened. Naive UTC on the way in, like every other timestamp here."""
    if value is None:
        return datetime.now(timezone.utc).replace(tzinfo=None)
    return (
        value.replace(tzinfo=None)
        if value.tzinfo is None
        else value.astimezone(timezone.utc).replace(tzinfo=None)
    )


@router.post("", response_model=BodyMetricOut, status_code=status.HTTP_201_CREATED)
def create_metric(
    payload: BodyMetricCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BodyMetricOut:
    recorded = _resolve_recorded_at(payload.recorded_at)
    metric = BodyMetric(
        owner_id=user.id,
        recorded_at=recorded,
        weight=payload.weight,
        body_fat=payload.body_fat,
        measurements=payload.measurements,
        notes=payload.notes,
    )
    db.add(metric)

    # Mirror the latest weight onto the athlete profile, which is what Home and
    # the coach read. BodyMetric stays the source of truth for history; this is
    # the one number they need, kept current. One-way, and only when this is
    # the newest weigh-in — filling in last month is not a statement about now.
    if payload.weight is not None:
        newest = db.scalar(
            select(BodyMetric.recorded_at)
            .where(BodyMetric.owner_id == user.id, BodyMetric.weight.isnot(None))
            .order_by(BodyMetric.recorded_at.desc())
            .limit(1)
        )
        if newest is None or recorded >= newest:
            from ..ai.service import get_or_create_profile  # local: avoids a cycle

            get_or_create_profile(db, user.id).current_weight = payload.weight

    db.commit()
    db.refresh(metric)
    return BodyMetricOut.model_validate(metric)


@router.delete("/{metric_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_metric(
    metric_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    metric = db.scalar(
        select(BodyMetric).where(
            BodyMetric.id == metric_id, BodyMetric.owner_id == user.id
        )
    )
    if metric is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Metric not found")
    db.delete(metric)
    db.commit()
