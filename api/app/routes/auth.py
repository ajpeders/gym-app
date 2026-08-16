"""Registration, login, and current-user routes."""
from __future__ import annotations

import secrets
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import oauth
from ..config import get_settings
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
from ..security import (
    create_token,
    decode_token_claims,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class OAuthIn(BaseModel):
    """The provider's token, from whichever flow the client ran."""

    token: str


@router.get("/providers")
def social_providers() -> dict:
    """Which social sign-ins this install can complete.

    The login screen asks before drawing any buttons: an install with no client
    ids configured shows none, rather than a button that fails on tap.
    """
    return {"providers": oauth.configured_providers()}


# Where a browser is allowed to be sent back to after signing in. An open
# redirect here would hand our session token to whoever asked for it, so the
# app's own scheme and the configured web origin are the whole list.
def _allowed_redirect(redirect_uri: str) -> bool:
    from ..config import get_settings

    if redirect_uri.startswith("gymapp://") or redirect_uri.startswith("exp://"):
        return True
    origins = get_settings().cors_origin_list
    if origins == ["*"]:
        # A wildcard CORS setting is for a LAN-only dev box; still refuse
        # anything that isn't local, because this one carries a token.
        return redirect_uri.startswith("http://localhost") or redirect_uri.startswith(
            "http://127.0.0.1"
        )
    return any(redirect_uri.startswith(origin) for origin in origins)


@router.get("/oauth/{provider}/start")
def oauth_start(provider: str, redirect_uri: str) -> RedirectResponse:
    """Send the browser to the provider.

    The flow starts here rather than in the app so the client secret stays on
    the server; the app only ever sees our own session token at the end.
    """
    if provider not in oauth.configured_providers() or provider not in oauth.AUTHORIZE_URLS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{provider.title()} sign-in isn't set up on this server.",
        )
    if not _allowed_redirect(redirect_uri):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That redirect isn't allowed."
        )
    # The state carries where to come back to, signed the same way sessions are
    # so a tampered redirect can't survive the round trip.
    state = create_token(0, extra={"redirect_uri": redirect_uri}, minutes=10)
    callback = f"{get_settings().self_base_url}/api/auth/oauth/{provider}/callback"
    return RedirectResponse(oauth.authorize_url(provider, callback, state))


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    provider: str, code: str, state: str, db: Session = Depends(get_db)
) -> RedirectResponse:
    """Where the provider sends them back. Ends at the app with our token."""
    try:
        claims = decode_token_claims(state)
        redirect_uri = claims.get("redirect_uri", "")
    except Exception as exc:  # noqa: BLE001 - a bad state is a failed sign-in
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That sign-in expired."
        ) from exc
    if not _allowed_redirect(redirect_uri):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="That redirect isn't allowed."
        )

    callback = f"{get_settings().self_base_url}/api/auth/oauth/{provider}/callback"
    try:
        provider_token = await oauth.exchange_code(provider, code, callback)
        identity = await oauth.verify(provider, provider_token)
    except oauth.OAuthError as exc:
        separator = "&" if "?" in redirect_uri else "?"
        return RedirectResponse(f"{redirect_uri}{separator}error={quote(str(exc))}")

    user = _find_or_create_oauth_user(db, identity)
    separator = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(f"{redirect_uri}{separator}token={create_token(user.id)}")


def _find_or_create_oauth_user(db: Session, identity: oauth.VerifiedIdentity) -> User:
    """The account behind a verified email — existing or new."""
    user = db.scalar(select(User).where(User.email == identity.email.lower()))
    if user is not None:
        return user
    user = User(
        email=identity.email.lower(),
        # No usable password: this account signs in through the provider. A
        # random hash rather than an empty one, so nothing can ever match it.
        password_hash=hash_password(secrets.token_urlsafe(32)),
        display_name=identity.name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/oauth/{provider}", response_model=TokenOut)
async def oauth_login(
    provider: str, payload: OAuthIn, db: Session = Depends(get_db)
) -> TokenOut:
    """Sign in (or sign up) with a provider token.

    The provider only supplies a *verified* email; everything after that is the
    ordinary account. An existing account with that address is signed into —
    which is safe precisely because the address was verified, and is what
    someone expects when they registered with a password and later tap
    "Continue with Google".
    """
    try:
        identity = await oauth.verify(provider, payload.token)
    except oauth.OAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    user = _find_or_create_oauth_user(db, identity)
    return TokenOut(token=create_token(user.id), user=UserOut.model_validate(user))


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
