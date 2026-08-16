"""Gym-floor calculators: plates, warmups, estimated max.

Server-side for the same reason the rest of the derived maths is: it's tested
here, and there's exactly one implementation. The client caches nothing and
computes nothing — a plate count that disagrees between platforms is worse than
either answer alone.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import calculators
from ..models import User
from ..schemas import OneRepMax, PlateBreakdown, WarmupSet
from ..security import get_current_user

router = APIRouter(prefix="/tools", tags=["tools"])


def _plates_for(units: str) -> list[float]:
    return calculators.LB_PLATES if units == "lb" else calculators.KG_PLATES


def _bar_for(units: str, bar: float | None) -> float:
    if bar is not None:
        return bar
    # The standard bar in each unit system — 20kg / 45lb.
    return 45.0 if units == "lb" else 20.0


@router.get("/plates", response_model=PlateBreakdown)
def plates(
    target: float = Query(gt=0),
    bar: float | None = None,
    units: str = "kg",
    user: User = Depends(get_current_user),
) -> PlateBreakdown:
    """What to load on each side for a target weight."""
    return PlateBreakdown(
        **calculators.plate_breakdown(target, _bar_for(units, bar), _plates_for(units)),
        units=units,
    )


@router.get("/warmup", response_model=list[WarmupSet])
def warmup(
    weight: float = Query(gt=0),
    bar: float | None = None,
    units: str = "kg",
    user: User = Depends(get_current_user),
) -> list[WarmupSet]:
    """A ramp from the empty bar up to just under the working weight."""
    return [
        WarmupSet(**s)
        for s in calculators.warmup_sets(weight, _bar_for(units, bar), _plates_for(units))
    ]


@router.get("/one-rep-max", response_model=OneRepMax | None)
def one_rep_max(
    weight: float = Query(gt=0),
    reps: int = Query(gt=0),
    user: User = Depends(get_current_user),
) -> OneRepMax | None:
    """Estimated max from a set, plus the percentage table trained off it."""
    result = calculators.one_rep_max(weight, reps)
    return None if result is None else OneRepMax(**result)
