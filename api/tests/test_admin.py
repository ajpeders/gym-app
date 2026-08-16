"""The operator's view.

Several things now exist with no way to observe them: crash reports go to a
logger only shell access can read, the catalog has holes, AI failures are
invisible until someone hits one, and there is no recovery path for a forgotten
password.

This is the first thing in the app that lets one account see anything about
another, so the tests care as much about the boundary as the features:
aggregate and operational data, never another person's training.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def admin(client, auth):
    """Promote the first account. Role lives on the user; `GYM_ADMIN_EMAIL` is
    the bootstrap for an install that has no admin yet."""
    from app.db import SessionLocal
    from app.models import User

    headers, user, _ = auth
    db = SessionLocal()
    try:
        row = db.get(User, int(user["id"]))
        row.role = "admin"
        db.commit()
    finally:
        db.close()
    return headers, user


# --- the boundary ----------------------------------------------------------

def test_an_ordinary_account_cannot_reach_the_admin_api(client, auth):
    headers, _, _ = auth
    for path in ("/api/admin/overview", "/api/admin/users", "/api/admin/errors"):
        assert client.get(path, headers=headers).status_code == 403, path


def test_signed_out_is_a_401_not_a_403(client):
    assert client.get("/api/admin/overview").status_code == 401


def test_an_admin_sees_accounts_but_not_their_training(client, admin, auth2):
    """Deliberate: the operator needs to know who exists and when they last
    logged in, not what they lifted."""
    headers, _ = admin
    rows = client.get("/api/admin/users", headers=headers).json()
    assert len(rows) >= 2
    for row in rows:
        assert set(row) == {
            "id",
            "email",
            "display_name",
            "role",
            "created_at",
            "session_count",
            "last_session_at",
        }


def test_the_admin_flag_is_visible_to_the_app(client, admin, auth2):
    """The app needs to know whether to show the admin entry point at all."""
    headers, _ = admin
    assert client.get("/api/auth/me", headers=headers).json()["is_admin"] is True
    other_headers, _, _ = auth2
    assert client.get("/api/auth/me", headers=other_headers).json()["is_admin"] is False


# --- operations ------------------------------------------------------------

def test_overview_reports_what_the_install_is_made_of(client, admin):
    headers, _ = admin
    body = client.get("/api/admin/overview", headers=headers).json()
    assert body["users"] >= 1
    assert body["exercises"] >= 1
    assert "sessions" in body and "custom_exercises" in body
    # The catalog's own health: images are 40% missing and that should be visible.
    assert "exercises_without_images" in body


def test_a_forgotten_password_can_be_reset(client, admin, auth2):
    """The live example: turning DEMO_MODE off nearly locked the owner out with
    no recovery except editing SQLite in the container by hand."""
    headers, _ = admin
    other_headers, other, _ = auth2

    r = client.post(
        f"/api/admin/users/{other['id']}/password",
        headers=headers,
        json={"password": "brand-new-password"},
    )
    assert r.status_code == 204, r.text

    assert client.post(
        "/api/auth/login",
        json={"email": other["email"], "password": "brand-new-password"},
    ).status_code == 200


def test_an_account_can_be_deleted_and_its_data_goes_with_it(client, admin, auth2):
    headers, _ = admin
    other_headers, other, _ = auth2
    client.post("/api/splits", headers=other_headers, json={"name": "Theirs"})

    assert client.delete(f"/api/admin/users/{other['id']}", headers=headers).status_code == 204
    assert client.post(
        "/api/auth/login", json={"email": other["email"], "password": "secret123"}
    ).status_code == 401


def test_an_admin_cannot_delete_themselves(client, admin):
    """One misplaced tap should not leave an install with no operator."""
    headers, user = admin
    assert client.delete(f"/api/admin/users/{user['id']}", headers=headers).status_code == 400


# --- crash reports ---------------------------------------------------------

def test_client_crashes_are_stored_and_readable(client, admin):
    headers, _ = admin
    client.post(
        "/api/errors",
        json={"message": "Boom on the workout screen", "platform": "ios", "context": "/workout/3"},
    )

    rows = client.get("/api/admin/errors", headers=headers).json()
    assert rows[0]["message"] == "Boom on the workout screen"
    assert rows[0]["platform"] == "ios"
    assert rows[0]["context"] == "/workout/3"


def test_a_crash_from_a_signed_out_client_is_still_kept(client, admin):
    """The login screen can crash too, and that's exactly when you want to know."""
    headers, _ = admin
    client.post("/api/errors", json={"message": "Crash before login"})
    rows = client.get("/api/admin/errors", headers=headers).json()
    assert any(r["message"] == "Crash before login" and r["user_id"] is None for r in rows)


def test_the_newest_crash_is_first(client, admin):
    headers, _ = admin
    client.post("/api/errors", json={"message": "older"})
    client.post("/api/errors", json={"message": "newer"})
    rows = client.get("/api/admin/errors", headers=headers).json()
    assert rows[0]["message"] == "newer"


# --- AI health -------------------------------------------------------------

def test_ai_calls_are_recorded_with_their_outcome(client, admin):
    """"Ollama returns 400" was a hunt because nothing recorded the attempts."""
    from app.ai import telemetry
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        telemetry.record(db, user_id=1, provider="ollama", model="qwen2.5", endpoint="coach",
                         ok=False, latency_ms=120, error="HTTP 400")
        telemetry.record(db, user_id=1, provider="ollama", model="qwen2.5", endpoint="coach",
                         ok=True, latency_ms=800)
    finally:
        db.close()

    headers, _ = admin
    body = client.get("/api/admin/ai", headers=headers).json()
    ollama = next(r for r in body["providers"] if r["provider"] == "ollama")
    assert ollama["calls"] >= 2
    assert ollama["failures"] >= 1
    assert ollama["avg_latency_ms"] > 0
    assert any("HTTP 400" in (c["error"] or "") for c in body["recent"])


def test_recording_ai_telemetry_never_breaks_the_call_it_measures(client):
    """Telemetry is the least important thing in any request it appears in."""
    from app.ai import telemetry

    class Exploding:
        def add(self, *_a, **_k):
            raise RuntimeError("db is gone")

        def commit(self):
            raise RuntimeError("db is gone")

    telemetry.record(Exploding(), user_id=1, provider="ollama", model="m", endpoint="coach",
                     ok=True, latency_ms=1)


def test_a_failed_ai_call_is_recorded_by_the_middleware(client, admin):
    """No provider is configured in tests, so /ai/models 502s — which is
    exactly the shape of the failure the operator view exists to surface."""
    headers, _ = admin
    client.get("/api/ai/models", headers=headers)

    body = client.get("/api/admin/ai", headers=headers).json()
    hit = next((c for c in body["recent"] if c["endpoint"] == "ai/models"), None)
    assert hit is not None, "the AI call was not recorded at all"
    assert hit["ok"] is False
    assert "HTTP" in (hit["error"] or "")
    assert hit["latency_ms"] is not None
