"""Registration, login, and current-user routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    AthleteProfile,
    CoachMessage,
    Exercise,
    ProgressPhoto,
    Settings,
    Split,
    User,
    Workout,
)
from ..schemas import LoginIn, RegisterIn, TokenOut, UserOut
from ..security import create_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def _ensure_settings(db: Session, user: User):
    if user.settings is None:
        db.add(Settings(user_id=user.id))
        db.commit()


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, db: Session = Depends(get_db)) -> TokenOut:
    email = payload.email.lower()
    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or email.split("@")[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(Settings(user_id=user.id))
    db.commit()
    return TokenOut(token=create_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    _ensure_settings(db, user)
    return TokenOut(token=create_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(current: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    current: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Permanently delete the current account and everything it owns.

    Settings, sessions (+ their exercises/sets), and body metrics are removed by
    the User relationship cascade on `db.delete(current)`. The rest is owned only
    by `owner_id`/`user_id` and is swept explicitly here, so no rows are left
    orphaned regardless of SQLite foreign-key enforcement. Custom exercises
    (owner_id set) go; the shared catalog (owner_id NULL) is untouched.
    """
    uid = current.id
    for row in db.scalars(select(Workout).where(Workout.owner_id == uid)):
        db.delete(row)  # cascades its WorkoutExercise rows
    for row in db.scalars(select(Split).where(Split.owner_id == uid)):
        db.delete(row)
    for row in db.scalars(select(ProgressPhoto).where(ProgressPhoto.owner_id == uid)):
        db.delete(row)
    for row in db.scalars(select(CoachMessage).where(CoachMessage.user_id == uid)):
        db.delete(row)
    for row in db.scalars(select(AthleteProfile).where(AthleteProfile.user_id == uid)):
        db.delete(row)
    for row in db.scalars(select(Exercise).where(Exercise.owner_id == uid)):
        db.delete(row)
    db.delete(current)
    db.commit()
