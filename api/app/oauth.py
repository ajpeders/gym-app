"""Signing in with Google, Apple or GitHub.

Only the *verification* lives here — turning a provider's token into a verified
email address. Everything after that is the app's ordinary account handling, so
a social login produces exactly the same session as a password one.

Two rules that matter more than the plumbing:

* **An unverified email is not an identity.** Matching an existing account on
  an email the provider hasn't verified would let anyone with a throwaway
  address claim someone's training. Providers that can return an unverified
  address are checked for the flag and refused without it.
* **Nothing is configured by default.** A provider with no client id is simply
  absent — from `/auth/providers`, from the login screen, and from the
  endpoint, which refuses it rather than half-attempting a flow.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from .config import get_settings

logger = logging.getLogger("gym.oauth")

SUPPORTED = ("google", "apple", "github")


@dataclass(frozen=True)
class VerifiedIdentity:
    email: str
    name: str
    provider: str


def configured_providers() -> list[str]:
    """Which social logins this install can actually complete."""
    cfg = get_settings()
    ids = {
        "google": cfg.google_client_id,
        "apple": cfg.apple_client_id,
        "github": cfg.github_client_id,
    }
    return [name for name, value in ids.items() if (value or "").strip()]


# Where to send someone to sign in, and where to swap the code they come back
# with for a token. Apple is absent deliberately — see `verify`.
AUTHORIZE_URLS = {
    "google": "https://accounts.google.com/o/oauth2/v2/auth",
    "github": "https://github.com/login/oauth/authorize",
}
TOKEN_URLS = {
    "google": "https://oauth2.googleapis.com/token",
    "github": "https://github.com/login/oauth/access_token",
}
SCOPES = {"google": "openid email profile", "github": "read:user user:email"}


def client_id(provider: str) -> str:
    cfg = get_settings()
    return {
        "google": cfg.google_client_id,
        "apple": cfg.apple_client_id,
        "github": cfg.github_client_id,
    }.get(provider, "") or ""


def client_secret(provider: str) -> str:
    cfg = get_settings()
    return {"google": cfg.google_client_secret, "github": cfg.github_client_secret}.get(
        provider, ""
    ) or ""


def authorize_url(provider: str, redirect_uri: str, state: str) -> str:
    """Where to send the browser to start a sign-in."""
    from urllib.parse import urlencode

    params = {
        "client_id": client_id(provider),
        "redirect_uri": redirect_uri,
        "scope": SCOPES.get(provider, "email"),
        "state": state,
        "response_type": "code",
    }
    return f"{AUTHORIZE_URLS[provider]}?{urlencode(params)}"


async def exchange_code(provider: str, code: str, redirect_uri: str) -> str:
    """Swap the code the provider redirected back with for a token.

    Done server-side so the client secret never reaches the app — which is the
    reason the flow starts on the server rather than in expo-auth-session.
    """
    if provider not in TOKEN_URLS:
        raise OAuthError(f"{provider.title()} sign-in isn't supported here.")
    payload = {
        "client_id": client_id(provider),
        "client_secret": client_secret(provider),
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.post(
                TOKEN_URLS[provider], data=payload, headers={"Accept": "application/json"}
            )
            response.raise_for_status()
            body = response.json()
    except httpx.HTTPError as exc:
        logger.warning("oauth code exchange failed for %s: %s", provider, type(exc).__name__)
        raise OAuthError("Couldn't complete that sign-in with the provider.") from exc

    # Google returns an id_token (which carries the verified email); GitHub
    # returns an access token used to read the account.
    token = body.get("id_token") if provider == "google" else body.get("access_token")
    if not token:
        raise OAuthError("The provider didn't return a usable token.")
    return token


class OAuthError(Exception):
    """The token didn't check out. Never carries the provider's raw response —
    that can contain the token itself."""


async def verify(provider: str, token: str) -> VerifiedIdentity:
    """Exchange a provider token for a verified email, or raise OAuthError.

    Google and Apple issue an id_token (a JWT) validated at the provider's
    tokeninfo endpoint; GitHub issues an access token used to read the account.
    Validating at the provider rather than locally keeps key rotation out of
    this codebase — the trade is one network call per sign-in, which is
    nothing next to a login.
    """
    if provider not in SUPPORTED:
        raise OAuthError(f"Unknown provider {provider!r}.")
    if provider not in configured_providers():
        raise OAuthError(f"{provider.title()} sign-in isn't set up on this server.")

    cfg = get_settings()
    timeout = httpx.Timeout(10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if provider == "github":
                response = await client.get(
                    "https://api.github.com/user",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github+json",
                    },
                )
                response.raise_for_status()
                account = response.json()
                email = (account.get("email") or "").strip()
                if not email:
                    # GitHub hides the address unless it's public; the separate
                    # endpoint carries the verified flag.
                    emails = await client.get(
                        "https://api.github.com/user/emails",
                        headers={"Authorization": f"Bearer {token}"},
                    )
                    emails.raise_for_status()
                    primary = next(
                        (e for e in emails.json() if e.get("primary") and e.get("verified")),
                        None,
                    )
                    if primary is None:
                        raise OAuthError("No verified email address on that GitHub account.")
                    email = primary["email"]
                return VerifiedIdentity(
                    email=email,
                    name=(account.get("name") or account.get("login") or email.split("@")[0]),
                    provider=provider,
                )

            # Google and Apple both expose a tokeninfo endpoint for id_tokens.
            url = (
                "https://oauth2.googleapis.com/tokeninfo"
                if provider == "google"
                else "https://appleid.apple.com/auth/keys"
            )
            if provider == "apple":
                # Apple has no tokeninfo endpoint; validating its id_token means
                # verifying the signature against its JWKS. Rather than
                # half-implement that here, the flow is refused until it's done
                # properly — a sign-in that "probably" checked out is worse than
                # one that isn't offered.
                raise OAuthError("Apple sign-in isn't finished on this server yet.")

            response = await client.get(url, params={"id_token": token})
            response.raise_for_status()
            claims = response.json()
    except OAuthError:
        raise
    except httpx.HTTPError as exc:
        logger.warning("oauth verification failed for %s: %s", provider, type(exc).__name__)
        raise OAuthError("Couldn't check that sign-in with the provider.") from exc

    audience = (cfg.google_client_id or "").strip()
    if audience and claims.get("aud") != audience:
        # A token minted for a different app is not a sign-in for this one.
        raise OAuthError("That sign-in was issued for a different app.")
    if str(claims.get("email_verified", "false")).lower() not in ("true", "1"):
        raise OAuthError("That account's email address isn't verified with the provider.")
    email = (claims.get("email") or "").strip()
    if not email:
        raise OAuthError("The provider didn't return an email address.")

    return VerifiedIdentity(
        email=email,
        name=(claims.get("name") or email.split("@")[0]),
        provider=provider,
    )
