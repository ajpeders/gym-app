"""Athlete profile (the AI companion's persistent memory)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai import service
from ..db import get_db
from ..models import User
from ..security import get_current_user

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileOut(BaseModel):
    experience_level: str | None = None
    height: float | None = None
    current_weight: float | None = None
    goal_weight: float | None = None
    goals: str | None = None
    injuries: list[str] = []
    equipment: str | None = None
    preferences: str | None = None
    notes: str | None = None
    session_note: str | None = None


class ProfileUpdate(BaseModel):
    experience_level: str | None = None
    height: float | None = None
    current_weight: float | None = None
    goal_weight: float | None = None
    goals: str | None = None
    injuries: list[str] | None = None
    equipment: str | None = None
    preferences: str | None = None
    notes: str | None = None
    session_note: str | None = None


@router.get("", response_model=ProfileOut)
def get_profile(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> ProfileOut:
    p = service.get_or_create_profile(db, user.id)
    return ProfileOut(**service.profile_dict(p))


@router.patch("", response_model=ProfileOut)
def update_profile(
    body: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ProfileOut:
    p = service.get_or_create_profile(db, user.id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(p, key, value)
    db.commit()
    db.refresh(p)
    return ProfileOut(**service.profile_dict(p))
