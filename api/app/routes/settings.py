"""Per-user settings."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Settings, User
from ..schemas import SettingsOut, SettingsUpdate
from ..security import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])


def _get_or_create(db: Session, user: User) -> Settings:
    if user.settings is None:
        s = Settings(user_id=user.id)
        db.add(s)
        db.commit()
        db.refresh(s)
        return s
    return user.settings


@router.get("", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> SettingsOut:
    return SettingsOut.model_validate(_get_or_create(db, user))


@router.patch("", response_model=SettingsOut)
def update_settings(
    payload: SettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SettingsOut:
    s = _get_or_create(db, user)
    data = payload.model_dump(exclude_unset=True)
    if "feature_flags" in data and data["feature_flags"] is not None:
        merged = dict(s.feature_flags or {})
        merged.update(data.pop("feature_flags"))
        s.feature_flags = merged
    for field, value in data.items():
        if value is not None:
            setattr(s, field, value)
    db.commit()
    db.refresh(s)
    return SettingsOut.model_validate(s)
