"""Wire the reusable `companion` package in as a tool-calling coach.

Unlike the plain `/ai/coach` chat, this coach can actually read and log training
by calling gym's own API as tools — using each user's configured provider
(Ollama or Claude, from their Settings) and grounded in their profile + history.
The provider seam this builds on was itself extracted from gym's `ai/`.
"""
from __future__ import annotations

from fastapi import Request

from companion import AnthropicProvider, Companion, OllamaProvider, Provider

from ..config import get_settings
from ..db import SessionLocal
from ..models import User
from ..security import decode_token
from . import prompts, service

# gym routes the coach may use as tools (OpenAPI paths are under /api).
EXPOSE = [
    "GET /api/workouts", "GET /api/workouts/*",
    "GET /api/exercises", "GET /api/exercises/*",
    "GET /api/routines", "GET /api/routines/*",
    "GET /api/stats/*",
    "POST /api/workouts", "POST /api/workouts/*",
    "PATCH /api/workouts/*",
    "POST /api/exercises",
]
# Never expose auth/settings/profile/ai as tools.
EXCLUDE = ["* /api/auth/*", "* /api/settings*", "* /api/profile*", "* /api/ai/*"]

TOOL_GUIDANCE = (
    "\n\nYou can use tools to read and log this athlete's training in the app. "
    "Read first (list recent workouts, find an exercise, check stats) before "
    "acting. To log training: start or pick a workout, resolve the exercise id "
    "via the exercises tool, then add the exercise and its sets. Confirm before "
    "anything destructive. Weights are in the athlete's chosen units. Keep "
    "replies short and coach-like."
)


def _uid(request: Request) -> int | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return decode_token(auth.split(" ", 1)[1])
    except Exception:  # noqa: BLE001 - any decode failure = anonymous
        return None


def _provider_for(s, cfg) -> Provider | None:
    """Build a companion Provider from the user's gym Settings (reuses gym's own
    provider-selection helpers). None = not configured."""
    if service._effective_provider(s, cfg) == "claude":
        if not service._provider_configured(s, "claude"):
            return None
        return AnthropicProvider(
            api_key=s.claude_api_key.strip(),
            model=service._claude_model(s, cfg),
            timeout=cfg.ai_timeout,
        )
    if not service._provider_configured(s, "ollama"):
        return None
    return OllamaProvider(
        base_url=service._normalize_url(s.ollama_url),
        model=service._ollama_model(s, cfg),
        timeout=cfg.ai_timeout,
    )


def resolve_provider(request: Request) -> Provider | None:
    """Per-request: the logged-in user's own provider. Raises ValueError (→ 503
    with detail) when they haven't set AI up — matching gym's no-silent-default rule."""
    uid = _uid(request)
    if uid is None:
        raise ValueError("Not signed in.")
    db = SessionLocal()
    try:
        user = db.get(User, uid)
        if user is None:
            raise ValueError("User not found.")
        provider = _provider_for(service._user_settings(db, user.id), get_settings())
        if provider is None:
            raise ValueError(
                "AI isn't set up yet — add your Ollama server or Claude key in Settings."
            )
        return provider
    finally:
        db.close()


def system_prompt(request: Request) -> str:
    """Per-request coach prompt grounded in the user's profile + recent training."""
    uid = _uid(request)
    db = SessionLocal()
    try:
        user = db.get(User, uid) if uid else None
        if user is None:
            return prompts.coach_system_prompt("there", "", "") + TOOL_GUIDANCE
        profile = service.get_or_create_profile(db, user.id)
        base = prompts.coach_system_prompt(
            user.display_name,
            service.profile_summary(profile),
            service._recent_training_summary(db, user.id),
        )
        return base + TOOL_GUIDANCE
    finally:
        db.close()


def mount(app) -> None:
    cfg = get_settings()
    companion = Companion(
        host_app=app,
        base_url=cfg.self_base_url,
        expose=EXPOSE,
        exclude=EXCLUDE,
        resolve_provider=resolve_provider,  # force BYO — each user brings Ollama/Claude
        system_prompt=system_prompt,
        write_policy="confirm",
        forward_auth=("authorization",),  # gym auths via Bearer JWT
        mount_prefix="/api/companion",
        max_steps=10,
        tool_timeout=cfg.ai_timeout,
    )
    app.include_router(companion.router, prefix="/api/companion")
