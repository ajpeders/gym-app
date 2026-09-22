"""GYM_ALLOW_REGISTRATION=false closes both signup doors.

The internet-facing deployment runs with registration closed, so existing
accounts keep working while strangers can't create new ones.
"""
from __future__ import annotations

import os
import uuid

import pytest

from app.config import get_settings


@pytest.fixture
def registration_closed():
    previous = os.environ.get("GYM_ALLOW_REGISTRATION")
    os.environ["GYM_ALLOW_REGISTRATION"] = "false"
    get_settings.cache_clear()
    yield
    if previous is None:
        del os.environ["GYM_ALLOW_REGISTRATION"]
    else:
        os.environ["GYM_ALLOW_REGISTRATION"] = previous
    get_settings.cache_clear()


def _new_email() -> str:
    return f"closed-{uuid.uuid4().hex[:8]}@example.com"


def test_register_is_refused(client, registration_closed):
    resp = client.post(
        "/api/auth/register",
        json={"email": _new_email(), "password": "secret123"},
    )
    assert resp.status_code == 403
    assert "closed" in resp.json()["detail"].lower()


def test_existing_account_still_logs_in(client, auth, registration_closed):
    """Closing the door must not lock out the accounts already through it."""
    _, user, _ = auth
    resp = client.post(
        "/api/auth/login",
        json={"email": user["email"], "password": "secret123"},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["email"] == user["email"]


def test_oauth_cannot_create_an_account(registration_closed):
    """The other signup door: first-time OAuth sign-in.

    Exercised at the helper rather than over HTTP, since no provider is
    configured in tests (/auth/providers returns an empty list).
    """
    from fastapi import HTTPException

    from app import oauth
    from app.db import SessionLocal
    from app.routes.auth import _find_or_create_oauth_user

    identity = oauth.VerifiedIdentity(
        email=_new_email(), name="Stranger", provider="google"
    )
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as excinfo:
            _find_or_create_oauth_user(db, identity)
        assert excinfo.value.status_code == 403
    finally:
        db.close()
