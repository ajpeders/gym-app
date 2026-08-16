"""Wire the reusable `companion` package in as a tool-calling coach.

Unlike the plain `/ai/coach` chat, this coach can actually read and log training
by calling gym's own API as tools — using each user's configured provider
(Ollama or Claude, from their Settings) and grounded in their profile + history.
The provider seam this builds on was itself extracted from gym's `ai/`.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import Request

from companion import AnthropicProvider, Companion, OllamaProvider, OpenAICompatibleProvider, Provider

from ..config import get_settings
from ..db import SessionLocal
from ..models import User
from ..security import decode_token
from . import prompts, service

# gym routes the coach may use as tools (OpenAPI paths are under /api).
EXPOSE = [
    "GET /api/workouts", "GET /api/workouts/*",
    "GET /api/exercises", "GET /api/exercises/*",
    "GET /api/sessions", "GET /api/sessions/*",
    "GET /api/splits", "GET /api/splits/*",
    "GET /api/stats/*",
    "POST /api/workouts", "POST /api/workouts/*",
    # Splits were readable but not creatable, so "make me a new split" had no
    # tool behind it. Rather than saying so, the model reached for
    # POST /api/workouts, padded the payload with exercise_id 1 ("Step Jack"),
    # left split_id null so the workout was orphaned, and reported it back as a
    # created split. A missing capability is worse than a refused one.
    "POST /api/splits", "PATCH /api/splits/*",
    "PATCH /api/workouts/*",
    "POST /api/sessions", "POST /api/sessions/*",
    "PATCH /api/sessions/*",
    "POST /api/exercises",
]
# Never expose auth/settings/profile/ai as tools.
EXCLUDE = ["* /api/auth/*", "* /api/settings*", "* /api/profile*", "* /api/ai/*"]

# Tool-usage guidance lives in editable skill files, appended by companion.
SKILLS_DIR = Path(__file__).parent / "skills"


def _uid(request: Request) -> int | None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return decode_token(auth.split(" ", 1)[1])
    except Exception:  # noqa: BLE001 - any decode failure = anonymous
        return None


def _provider_for(s, cfg, kind: str | None = None) -> Provider | None:
    """Build a companion Provider from the user's gym Settings (reuses gym's own
    provider-selection helpers). `kind` overrides the user's default choice
    (per-conversation picker). None = not configured."""
    selected = kind or service._effective_provider(s, cfg)
    if selected == "claude":
        if not service._provider_configured(s, "claude"):
            return None
        return AnthropicProvider(
            api_key=s.claude_api_key.strip(),
            model=service._claude_model(s, cfg),
            timeout=cfg.ai_timeout,
        )
    if selected == "openai":
        if not service._provider_configured(s, "openai"):
            return None
        return OpenAICompatibleProvider(
            base_url=cfg.openai_base_url,
            api_key=s.openai_api_key.strip(),
            model=service._openai_model(s, cfg),
            name="openai",
            timeout=cfg.ai_timeout,
        )
    if not service._provider_configured(s, "ollama"):
        return None
    return OllamaProvider(
        base_url=service._normalize_url(s.ollama_url),
        model=service._ollama_model(s, cfg),
        # Thinking models (qwen3) think on every tool-selection turn — 15-29s vs
        # 3s per logging request in the spike, at zero measured accuracy cost.
        think=False,
        timeout=cfg.ai_timeout,
    )


def resolve_provider(request: Request) -> Provider | None:
    """Per-request: the logged-in user's own provider. The chat body may carry
    `"provider": "ollama"|"claude"` to pick per conversation; otherwise the
    user's Settings default applies. Raises ValueError (→ 503 with detail) when
    the choice isn't configured — matching gym's no-silent-default rule."""
    uid = _uid(request)
    if uid is None:
        raise ValueError("Not signed in.")
    hint = getattr(request.state, "provider_hint", None)
    if hint is not None and hint not in ("ollama", "claude", "openai"):
        raise ValueError(f"Unknown provider {hint!r} — use 'ollama', 'claude', or 'openai'.")
    db = SessionLocal()
    try:
        user = db.get(User, uid)
        if user is None:
            raise ValueError("User not found.")
        provider = _provider_for(service._user_settings(db, user.id), get_settings(), hint)
        if provider is None:
            if hint:
                raise ValueError(
                    f"{'Claude' if hint == 'claude' else 'ChatGPT' if hint == 'openai' else 'Ollama'} isn't set up — "
                    "configure it in Settings first."
                )
            raise ValueError(
                "AI isn't set up yet — add your Ollama server, Claude key, or OpenAI key in Settings."
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
            return prompts.coach_system_prompt("there", "", "")
        profile = service.get_or_create_profile(db, user.id)
        return prompts.coach_system_prompt(
            user.display_name,
            service.profile_summary(profile),
            service._recent_training_summary(db, user.id),
        )
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
        skills_dir=str(SKILLS_DIR),
        write_policy="confirm",
        forward_auth=("authorization",),  # gym auths via Bearer JWT
        mount_prefix="/api/companion",
        max_steps=10,
        tool_timeout=cfg.ai_timeout,
    )
    app.include_router(companion.router, prefix="/api/companion")
