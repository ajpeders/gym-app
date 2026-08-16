"""Shared pytest fixtures: isolated DB, TestClient, seeded user + token."""
from __future__ import annotations

import os
import tempfile

import pytest

# Configure the environment BEFORE importing the app so settings/engine pick it up.
_TMPDIR = tempfile.mkdtemp(prefix="gym-test-")
os.environ["GYM_DATA_DIR"] = _TMPDIR
os.environ["GYM_SEED_ON_START"] = "false"
os.environ["GYM_JWT_SECRET"] = "test-secret"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Exercise  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _setup_db():
    init_db()
    db = SessionLocal()
    try:
        # Insert a couple of global exercises directly (no network seed).
        db.add_all(
            [
                Exercise(
                    external_id="Barbell_Bench_Press",
                    name="Barbell Bench Press",
                    category="strength",
                    equipment="barbell",
                    force="push",
                    level="beginner",
                    mechanic="compound",
                    primary_muscles=["chest"],
                    secondary_muscles=["triceps", "shoulders"],
                    instructions=["Lie on the bench.", "Press the bar up."],
                    images=["https://example.com/bench/0.jpg"],
                ),
                Exercise(
                    external_id="Barbell_Squat",
                    name="Barbell Squat",
                    category="strength",
                    equipment="barbell",
                    force="push",
                    level="intermediate",
                    mechanic="compound",
                    primary_muscles=["quadriceps"],
                    secondary_muscles=["glutes", "hamstrings"],
                    instructions=["Rack the bar.", "Squat down and up."],
                    images=["https://example.com/squat/0.jpg"],
                ),
            ]
        )
        db.commit()
    finally:
        db.close()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth(client):
    """Register a fresh user and return (headers, user_dict, token)."""
    import uuid

    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "secret123", "display_name": "Tester"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    headers = {"Authorization": f"Bearer {data['token']}"}
    return headers, data["user"], data["token"]


@pytest.fixture
def auth2(client):
    """A second account, for checking one athlete can't see another's data."""
    import uuid

    email = f"other-{uuid.uuid4().hex[:8]}@example.com"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "secret123", "display_name": "Other"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return {"Authorization": f"Bearer {data['token']}"}, data["user"], data["token"]
