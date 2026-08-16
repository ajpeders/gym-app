"""The operator's view: accounts, crashes, AI health, and what the install holds.

This is the first thing in the app that lets one account see anything about
another, so the scope is deliberate: **aggregate and operational data, never
another person's training.** An admin can see that you have 42 sessions and
when the last one was; they cannot read them.

Admin is a role on the user. `GYM_ADMIN_EMAIL` is the bootstrap for an install
that doesn't have one yet — otherwise granting the first admin would mean
editing SQLite in the container by hand, which is the exact problem this page
exists to remove.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session as SASession

from ..accounts import purge_user
from ..config import get_settings
from ..db import get_db
from ..models import AiCall, ClientError, Exercise, Session, User
from ..security import get_current_user, hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    """403 for a signed-in non-admin; `get_current_user` already 401s otherwise.

    The distinction matters: 401 means "log in", 403 means "you're logged in
    and this still isn't yours", and conflating them sends people to a login
    screen that won't help.
    """
    admin_email = (get_settings().admin_email or "").strip().lower()
    if user.role == "admin" or (admin_email and user.email.lower() == admin_email):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")


class AdminUser(BaseModel):
    id: int
    email: str
    display_name: str
    role: str
    created_at: datetime
    # Operational, not personal: how much they train, not what they train.
    session_count: int
    last_session_at: datetime | None = None


class Overview(BaseModel):
    users: int
    sessions: int
    exercises: int
    custom_exercises: int
    # The catalog's own health — 40% of rows have no image and that should be
    # visible rather than folklore.
    exercises_without_images: int
    client_errors_7d: int
    ai_calls_7d: int
    ai_failures_7d: int


class ClientErrorOut(BaseModel):
    id: int
    user_id: int | None = None
    message: str
    stack: str | None = None
    context: str | None = None
    platform: str | None = None
    app_version: str | None = None
    created_at: datetime


class ProviderHealth(BaseModel):
    provider: str
    calls: int
    failures: int
    avg_latency_ms: int


class AiCallOut(BaseModel):
    id: int
    provider: str
    model: str | None = None
    endpoint: str
    ok: bool
    latency_ms: int | None = None
    error: str | None = None
    created_at: datetime


class AiHealth(BaseModel):
    providers: list[ProviderHealth] = []
    recent: list[AiCallOut] = []


class PasswordReset(BaseModel):
    password: str = Field(min_length=1, max_length=200)


def _since(days: int) -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)


@router.get("/overview", response_model=Overview)
def overview(db: SASession = Depends(get_db), _: User = Depends(require_admin)) -> Overview:
    """Counts worth glancing at: accounts, training, catalog, and recent trouble."""
    def count(stmt) -> int:
        return db.scalar(stmt) or 0

    week = _since(7)
    return Overview(
        users=count(select(func.count()).select_from(User)),
        sessions=count(select(func.count()).select_from(Session)),
        exercises=count(select(func.count()).select_from(Exercise)),
        custom_exercises=count(
            select(func.count()).select_from(Exercise).where(Exercise.owner_id.is_not(None))
        ),
        exercises_without_images=count(
            select(func.count())
            .select_from(Exercise)
            .where(Exercise.owner_id.is_(None), Exercise.images == [])
        ),
        client_errors_7d=count(
            select(func.count()).select_from(ClientError).where(ClientError.created_at >= week)
        ),
        ai_calls_7d=count(
            select(func.count()).select_from(AiCall).where(AiCall.created_at >= week)
        ),
        ai_failures_7d=count(
            select(func.count())
            .select_from(AiCall)
            .where(AiCall.created_at >= week, AiCall.ok.is_(False))
        ),
    )


@router.get("/users", response_model=list[AdminUser])
def list_users(
    db: SASession = Depends(get_db), _: User = Depends(require_admin)
) -> list[AdminUser]:
    """Who exists, and how active they are — not what they lift."""
    rows = db.execute(
        select(
            User,
            func.count(Session.id),
            func.max(Session.started_at),
        )
        .outerjoin(Session, Session.owner_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at)
    ).all()
    return [
        AdminUser(
            id=user.id,
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            created_at=user.created_at,
            session_count=session_count or 0,
            last_session_at=last_session_at,
        )
        for user, session_count, last_session_at in rows
    ]


# No return annotation on the 204s: FastAPI reads `-> None` as a response model
# and then refuses it, because 204 can't carry a body.
@router.post("/users/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int,
    payload: PasswordReset,
    db: SASession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """The recovery path. Without it, a forgotten password means editing the
    database by hand inside the container."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    target.password_hash = hash_password(payload.password)
    db.commit()


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: SASession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Delete an account and everything it owns (the model cascades)."""
    if user_id == admin.id:
        # One misplaced tap should not leave an install with no operator.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Delete your own account from Settings, not from here.",
        )
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    # The same sweep the owner's own delete uses: a row left behind here would
    # be inherited by whoever gets that id next.
    purge_user(db, target)


@router.get("/errors", response_model=list[ClientErrorOut])
def client_errors(
    limit: int = Query(default=50, ge=1, le=500),
    db: SASession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[ClientErrorOut]:
    """Crash reports, newest first."""
    rows = db.scalars(
        select(ClientError).order_by(ClientError.created_at.desc(), ClientError.id.desc()).limit(limit)
    ).all()
    return [ClientErrorOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/ai", response_model=AiHealth)
def ai_health(
    days: int = Query(default=7, ge=1, le=90),
    db: SASession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AiHealth:
    """Per-provider success and latency, plus the most recent calls.

    This is the view that would have made "Ollama returns 400" obvious: one
    provider, every call failing, instantly, with the model right there.
    """
    since = _since(days)
    rows = db.execute(
        select(
            AiCall.provider,
            func.count(AiCall.id),
            func.sum(case((AiCall.ok.is_(False), 1), else_=0)),
            func.avg(AiCall.latency_ms),
        )
        .where(AiCall.created_at >= since)
        .group_by(AiCall.provider)
    ).all()

    recent = db.scalars(
        select(AiCall).order_by(AiCall.created_at.desc(), AiCall.id.desc()).limit(25)
    ).all()

    return AiHealth(
        providers=[
            ProviderHealth(
                provider=provider,
                calls=calls or 0,
                failures=int(failures or 0),
                avg_latency_ms=int(avg_latency or 0),
            )
            for provider, calls, failures, avg_latency in rows
        ],
        recent=[AiCallOut.model_validate(r, from_attributes=True) for r in recent],
    )
