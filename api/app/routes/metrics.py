"""Body metrics tracking."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import BodyMetric, User, utcnow
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


@router.post("", response_model=BodyMetricOut, status_code=status.HTTP_201_CREATED)
def create_metric(
    payload: BodyMetricCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BodyMetricOut:
    metric = BodyMetric(
        owner_id=user.id,
        recorded_at=utcnow(),
        weight=payload.weight,
        body_fat=payload.body_fat,
        measurements=payload.measurements,
        notes=payload.notes,
    )
    db.add(metric)
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
