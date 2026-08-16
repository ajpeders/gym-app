"""Record what the AI layer actually did.

Per-request `latency_ms` is already returned to the client, which helps exactly
once — while you're looking at it. "Ollama returns HTTP 400" took an afternoon
to diagnose because nothing kept the attempts, so the operator view had nothing
to show and the pattern (one model, every call, instantly) was invisible.

The one rule: this is the least important thing in any request it appears in.
A telemetry failure must never surface as a failed AI call.
"""
from __future__ import annotations

import logging

from ..models import AiCall

logger = logging.getLogger("gym.ai")

_MAX_ERROR = 1000


def record(
    db,
    *,
    user_id: int | None,
    provider: str,
    model: str | None,
    endpoint: str,
    ok: bool,
    latency_ms: int | None = None,
    error: str | None = None,
) -> None:
    """Write one AI call to the log. Swallows its own failures by design."""
    try:
        db.add(
            AiCall(
                user_id=user_id,
                provider=provider,
                model=model,
                endpoint=endpoint,
                ok=ok,
                latency_ms=latency_ms,
                error=(error or None) and error[:_MAX_ERROR],
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 - never break the call being measured
        logger.debug("ai telemetry not recorded", exc_info=True)


async def middleware(request, call_next):
    """Record every call to an AI surface, whatever happens to it.

    Middleware rather than instrumenting each endpoint: there are a dozen call
    sites in `service.py`, they change often, and the one that matters most is
    the one nobody remembered to wrap. This also catches failures that never
    reach the service layer at all — a provider that isn't configured, a token
    that expired, a 400 from a model with no tool support.

    Two honest limitations, both preferable to no record: for a streaming
    response the latency is time-to-first-byte, not total generation, and a
    non-2xx is recorded by its status code because the body may be a stream
    that hasn't been produced yet.
    """
    import time

    path = request.url.path
    if not (path.startswith("/api/ai") or path.startswith("/api/companion")):
        return await call_next(request)

    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001 - re-raised immediately
        _record_request(request, path, started, ok=False, error=repr(exc)[:200])
        raise

    ok = response.status_code < 400
    _record_request(
        request,
        path,
        started,
        ok=ok,
        error=None if ok else f"HTTP {response.status_code}",
    )
    return response


def _record_request(request, path: str, started: float, *, ok: bool, error: str | None) -> None:
    """Resolve who and which provider, then write the row. Best effort."""
    import time

    latency_ms = int((time.monotonic() - started) * 1000)
    try:
        from ..config import get_settings
        from ..db import SessionLocal
        from ..models import User
        from ..security import decode_token
        from . import service

        auth = request.headers.get("authorization", "")
        user_id = None
        if auth.lower().startswith("bearer "):
            try:
                user_id = decode_token(auth.split(" ", 1)[1])
            except Exception:  # noqa: BLE001 - an anonymous call is still a call
                user_id = None

        db = SessionLocal()
        try:
            provider, model = "unknown", None
            if user_id is not None and db.get(User, user_id) is not None:
                cfg = get_settings()
                s = service._user_settings(db, user_id)
                provider = service._effective_provider(s, cfg)
                model = (
                    service._claude_model(s, cfg)
                    if provider == "claude"
                    else service._ollama_model(s, cfg)
                )
            record(
                db,
                user_id=user_id,
                provider=provider,
                model=model,
                endpoint=path.removeprefix("/api/"),
                ok=ok,
                latency_ms=latency_ms,
                error=error,
            )
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - never break the call being measured
        logger.debug("ai telemetry not recorded", exc_info=True)
