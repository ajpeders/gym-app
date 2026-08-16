"""Registration, login, and current-user routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..accounts import purge_user
from ..models import (
    AthleteProfile,
    BodyMetric,
    CoachMessage,
    Exercise,
    NutritionEntry,
    ProgressPhoto,
    Session as TrainingSession,
    Settings,
    Split,
    User,
    Workout,
    utcnow,
)
from ..schemas import (
    BodyMetricOut,
    ExerciseOut,
    LoginIn,
    NutritionEntryOut,
    ProgressPhotoOut,
    RegisterIn,
    SessionOut,
    SettingsOut,
    SplitOut,
    TokenOut,
    UserOut,
    WorkoutOut,
)
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

    The sweep lives in `app/accounts.py` because an operator can delete an
    account too, and the two paths leaving different rows behind is how an
    orphan gets adopted by the next person to sign up — SQLite reuses ids.
    """
    purge_user(db, current)


# The export is checked against the same list `delete_me` sweeps: anything the
# account owns, you can take with you. Deleting an account you can't export
# first is a one-way door.
_EXPORT_FORMAT_VERSION = 1


@router.get("/me/export")
def export_me(
    current: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    """Everything this account owns, as one JSON document.

    Deliberately built from the same `*Out` schemas the API already serves, so
    an export reads like the API rather than like the database — and so a new
    field shows up here automatically instead of being silently left behind.

    The shared exercise catalog is *not* included: 828 rows nobody owns is
    noise. Custom exercises are. Progress photos come as a manifest — the image
    bytes are fetched per photo from their existing endpoint.
    """
    uid = current.id

    def owned(model, column):
        return db.scalars(select(model).where(column == uid)).all()

    settings = db.scalar(select(Settings).where(Settings.user_id == uid))
    profile = db.scalar(select(AthleteProfile).where(AthleteProfile.user_id == uid))

    return {
        "format_version": _EXPORT_FORMAT_VERSION,
        "exported_at": utcnow().isoformat(),
        "user": UserOut.model_validate(current).model_dump(),
        # SettingsOut already omits claude_api_key (write-only), and no password
        # hash is on any Out schema — nothing secret leaves in here.
        "settings": SettingsOut.model_validate(settings).model_dump() if settings else None,
        "athlete_profile": (
            {
                c.name: getattr(profile, c.name)
                for c in AthleteProfile.__table__.columns
                if c.name not in ("id", "user_id")
            }
            if profile
            else None
        ),
        "splits": [SplitOut.model_validate(r).model_dump() for r in owned(Split, Split.owner_id)],
        "workouts": [
            WorkoutOut.model_validate(r).model_dump() for r in owned(Workout, Workout.owner_id)
        ],
        "sessions": [
            SessionOut.model_validate(r).model_dump()
            for r in owned(TrainingSession, TrainingSession.owner_id)
        ],
        "body_metrics": [
            BodyMetricOut.model_validate(r).model_dump()
            for r in owned(BodyMetric, BodyMetric.owner_id)
        ],
        "nutrition": [
            NutritionEntryOut.model_validate(r).model_dump()
            for r in owned(NutritionEntry, NutritionEntry.owner_id)
        ],
        "custom_exercises": [
            ExerciseOut.model_validate(r).model_dump() for r in owned(Exercise, Exercise.owner_id)
        ],
        "progress_photos": [
            ProgressPhotoOut.model_validate(r).model_dump()
            for r in owned(ProgressPhoto, ProgressPhoto.owner_id)
        ],
        "coach_messages": [
            {"role": r.role, "content": r.content, "created_at": r.created_at}
            for r in owned(CoachMessage, CoachMessage.user_id)
        ],
    }
