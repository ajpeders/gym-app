"""Forgotten passwords.

A self-hosted install may have no mail relay at all, so the flow has to be
honest about that rather than pretending a code went out. Where mail works,
the code is a one-time, expiring secret, and the reply never says whether
the address has an account.
"""
from datetime import timedelta

import pytest

from app import routes
from app.config import get_settings


def _register(client, email, password="secret123"):
    r = client.post("/api/auth/register", json={"email": email, "password": password, "display_name": "T"})
    assert r.status_code == 201, r.text


def test_without_a_mail_server_it_says_so(client):
    _register(client, "nomail@example.com")
    r = client.post("/api/auth/forgot", json={"email": "nomail@example.com"})
    assert r.status_code == 200
    assert r.json()["delivered"] is False
    assert "runs it" in r.json()["message"]


@pytest.fixture
def mailbox(monkeypatch):
    """Pretend a relay is configured and capture what would have been sent."""
    sent = []
    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.example.com")
    monkeypatch.setattr(routes.auth, "send_reset_code", lambda to, code: sent.append((to, code)) or True)
    yield sent
    monkeypatch.setattr(get_settings(), "smtp_host", "")


def test_a_code_is_mailed_and_resets_the_password(client, mailbox):
    _register(client, "reset@example.com", "oldpass1")
    r = client.post("/api/auth/forgot", json={"email": "Reset@Example.com"})
    assert r.status_code == 200 and r.json()["delivered"] is True
    assert len(mailbox) == 1
    to, code = mailbox[0]
    assert to == "reset@example.com" and len(code) == 6

    r = client.post("/api/auth/reset", json={"email": "reset@example.com", "code": code, "password": "newpass1"})
    assert r.status_code == 200, r.text
    assert r.json()["token"]
    assert client.post("/api/auth/login", json={"email": "reset@example.com", "password": "newpass1"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "reset@example.com", "password": "oldpass1"}).status_code == 401
    # One-time: the same code is spent.
    r = client.post("/api/auth/reset", json={"email": "reset@example.com", "code": code, "password": "again123"})
    assert r.status_code == 400


def test_an_unknown_address_gets_the_same_answer(client, mailbox):
    r = client.post("/api/auth/forgot", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and r.json()["delivered"] is True
    assert mailbox == []


def test_a_wrong_or_expired_code_is_refused(client, mailbox):
    _register(client, "expired@example.com")
    client.post("/api/auth/forgot", json={"email": "expired@example.com"})
    _, code = mailbox[0]
    wrong = client.post("/api/auth/reset", json={"email": "expired@example.com", "code": "000000", "password": "newpass1"})
    assert wrong.status_code == 400

    from app.db import SessionLocal
    from app.models import User, utcnow

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email="expired@example.com").one()
        user.reset_expires_at = utcnow() - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()
    late = client.post("/api/auth/reset", json={"email": "expired@example.com", "code": code, "password": "newpass1"})
    assert late.status_code == 400
