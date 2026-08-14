"""Where a crash goes to be remembered.

Nothing recorded errors before this — an app crash mid-session vanished with
the app, which is the one moment you'd most want a trace. This is deliberately
the smallest thing that ends that: the client posts what it caught, the API
writes it to its own log next to its unhandled exceptions, and there is a
single place to look.

No new dependency and no new service to run. If a real error backend is ever
wanted, it plugs in behind this one function rather than being wired through
every screen — and a self-hosted Sentry/GlitchTip DSN is the natural next step.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import bearer_scheme, decode_token

router = APIRouter(tags=["errors"])

# A separate logger so client crashes can be filtered from server ones.
logger = logging.getLogger("gym.client")

# A runaway stack must not become a way to flood the log.
_MAX_STACK = 8000
_MAX_FIELD = 200


class ErrorReport(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    stack: str | None = None
    # Where it happened, as the client understands it: route, platform, build.
    context: str | None = None
    platform: str | None = None
    app_version: str | None = None

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        """A whitespace-only message is a report with nothing in it."""
        if not v.strip():
            raise ValueError("message must not be blank")
        return v.strip()


def _maybe_user(request: Request, db: Session) -> User | None:
    """Best-effort identity. A crash report must never fail on a bad token —
    the login screen can crash too, and that is exactly when you want to know."""
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return db.get(User, decode_token(auth.split(" ", 1)[1].strip()))
    except Exception:  # noqa: BLE001 - identity is a nicety here, never a gate
        return None


@router.post("/errors", status_code=status.HTTP_202_ACCEPTED)
def report_error(
    payload: ErrorReport,
    request: Request,
    db: Session = Depends(get_db),
    _credentials=Depends(bearer_scheme),
) -> dict[str, str]:
    """Accept a client crash. Always 202 — a report is never worth an error."""
    user = _maybe_user(request, db)
    parts = [f"client error: {payload.message[:2000]}"]
    if user is not None:
        parts.append(f"user={user.id}")
    for label, value in (
        ("platform", payload.platform),
        ("version", payload.app_version),
        ("context", payload.context),
    ):
        if value:
            parts.append(f"{label}={value[:_MAX_FIELD]}")
    if payload.stack:
        parts.append(f"\n{payload.stack[:_MAX_STACK]}")
    logger.error(" ".join(parts))
    return {"status": "recorded"}
