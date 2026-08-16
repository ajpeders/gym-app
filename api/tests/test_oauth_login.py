"""Signing in with a provider.

The verification is stubbed — what these hold is everything *around* it, which
is where the security lives: an unverified email is not an identity, a provider
with no client id doesn't exist, and a social sign-in produces exactly the same
session as a password one.
"""
from __future__ import annotations

import pytest

from app import oauth
from app.oauth import OAuthError, VerifiedIdentity


@pytest.fixture
def google_configured(monkeypatch):
    monkeypatch.setattr(oauth, "configured_providers", lambda: ["google"])


@pytest.fixture
def verifies_as(monkeypatch):
    def _install(email: str, name: str = "Alex"):
        async def _fake(provider: str, token: str) -> VerifiedIdentity:
            return VerifiedIdentity(email=email, name=name, provider=provider)

        monkeypatch.setattr(oauth, "verify", _fake)

    return _install


def test_nothing_is_offered_until_a_client_id_is_configured(client):
    """A button that fails on tap is worse than no button."""
    assert client.get("/api/auth/providers").json() == {"providers": []}


def test_a_configured_provider_is_advertised(client, google_configured):
    assert client.get("/api/auth/providers").json()["providers"] == ["google"]


def test_an_unconfigured_provider_is_refused_not_half_attempted(client):
    r = client.post("/api/auth/oauth/google", json={"token": "whatever"})
    assert r.status_code == 401
    assert "isn't set up" in r.json()["detail"]


def test_an_unknown_provider_is_refused(client, google_configured):
    assert client.post("/api/auth/oauth/myspace", json={"token": "x"}).status_code == 401


def test_a_first_sign_in_creates_an_ordinary_account(client, google_configured, verifies_as):
    verifies_as("new-person@example.com", name="New Person")

    r = client.post("/api/auth/oauth/google", json={"token": "good"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "new-person@example.com"
    assert body["user"]["display_name"] == "New Person"

    # The session it hands back is the ordinary one.
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "new-person@example.com"


def test_signing_in_twice_does_not_create_a_second_account(client, google_configured, verifies_as):
    verifies_as("repeat@example.com")
    first = client.post("/api/auth/oauth/google", json={"token": "good"}).json()
    second = client.post("/api/auth/oauth/google", json={"token": "good"}).json()
    assert first["user"]["id"] == second["user"]["id"]


def test_it_signs_into_an_account_that_registered_with_a_password(
    client, google_configured, verifies_as
):
    """Which is what someone expects when they later tap "Continue with
    Google" — and is only safe because the address was verified."""
    client.post(
        "/api/auth/register",
        json={"email": "both@example.com", "password": "secret123", "display_name": "Both"},
    )
    verifies_as("both@example.com")

    body = client.post("/api/auth/oauth/google", json={"token": "good"}).json()
    assert body["user"]["email"] == "both@example.com"
    assert body["user"]["display_name"] == "Both"  # the existing account, not a new one


def test_the_created_account_has_no_guessable_password(client, google_configured, verifies_as):
    """It signs in through the provider; nothing should get in with a password."""
    verifies_as("nopassword@example.com")
    client.post("/api/auth/oauth/google", json={"token": "good"})

    for attempt in ("", " ", "password", "nopassword@example.com"):
        r = client.post(
            "/api/auth/login", json={"email": "nopassword@example.com", "password": attempt}
        )
        assert r.status_code == 401, attempt


def test_a_provider_error_is_a_401_with_its_reason(client, google_configured, monkeypatch):
    async def _refuse(provider: str, token: str):
        raise OAuthError("That account's email address isn't verified with the provider.")

    monkeypatch.setattr(oauth, "verify", _refuse)

    r = client.post("/api/auth/oauth/google", json={"token": "bad"})
    assert r.status_code == 401
    assert "isn't verified" in r.json()["detail"]


# --- the redirect flow -----------------------------------------------------
#
# The client secret stays on the server, so the browser starts here rather than
# in the app. That makes two things this app's own code must get right: where a
# browser may be sent back to, and that the state can't be tampered with.

def test_starting_a_flow_that_is_not_configured_is_a_404(client):
    r = client.get(
        "/api/auth/oauth/google/start?redirect_uri=gymapp://oauth-callback",
        follow_redirects=False,
    )
    assert r.status_code == 404


def test_a_configured_flow_sends_you_to_the_provider(client, google_configured, monkeypatch):
    monkeypatch.setattr(oauth, "client_id", lambda provider: "test-client-id")

    r = client.get(
        "/api/auth/oauth/google/start?redirect_uri=gymapp://oauth-callback",
        follow_redirects=False,
    )
    assert r.status_code == 307
    location = r.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth")
    assert "client_id=test-client-id" in location
    # Our own callback, not the app's — the code is exchanged server-side.
    assert "auth%2Foauth%2Fgoogle%2Fcallback" in location


def test_a_redirect_somewhere_else_is_refused(client, google_configured):
    """An open redirect here would hand our session token to whoever asked."""
    for hostile in (
        "https://evil.example.com/steal",
        "http://evil.example.com",
        "//evil.example.com",
    ):
        r = client.get(
            f"/api/auth/oauth/google/start?redirect_uri={hostile}", follow_redirects=False
        )
        assert r.status_code == 400, hostile


def test_the_callback_refuses_a_tampered_state(client, google_configured):
    r = client.get(
        "/api/auth/oauth/google/callback?code=abc&state=not-a-real-token",
        follow_redirects=False,
    )
    assert r.status_code == 400


def test_a_completed_flow_comes_back_to_the_app_with_our_token(
    client, google_configured, verifies_as, monkeypatch
):
    verifies_as("redirected@example.com")

    async def _exchange(provider, code, redirect_uri):
        return "provider-token"

    monkeypatch.setattr(oauth, "exchange_code", _exchange)

    start = client.get(
        "/api/auth/oauth/google/start?redirect_uri=gymapp://oauth-callback",
        follow_redirects=False,
    )
    state = start.headers["location"].split("state=")[1].split("&")[0]

    done = client.get(
        f"/api/auth/oauth/google/callback?code=abc&state={state}", follow_redirects=False
    )
    assert done.status_code == 307
    assert done.headers["location"].startswith("gymapp://oauth-callback?token=")

    # And that token is a working session.
    token = done.headers["location"].split("token=")[1]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == "redirected@example.com"


def test_a_provider_failure_comes_back_as_an_error_not_a_token(
    client, google_configured, monkeypatch
):
    async def _exchange(provider, code, redirect_uri):
        raise OAuthError("Couldn't complete that sign-in with the provider.")

    monkeypatch.setattr(oauth, "exchange_code", _exchange)

    start = client.get(
        "/api/auth/oauth/google/start?redirect_uri=gymapp://oauth-callback",
        follow_redirects=False,
    )
    state = start.headers["location"].split("state=")[1].split("&")[0]
    done = client.get(
        f"/api/auth/oauth/google/callback?code=abc&state={state}", follow_redirects=False
    )
    assert "error=" in done.headers["location"]
    assert "token=" not in done.headers["location"]
