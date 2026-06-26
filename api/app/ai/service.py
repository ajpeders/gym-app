"""Provider selection, exercise matching, and the parse entrypoint."""
from __future__ import annotations

import re
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Exercise, Settings, User, WorkoutExercise
from .base import AIError, Provider
from .claude import ClaudeProvider
from .ollama import OllamaProvider

_WORD_RE = re.compile(r"[^a-z0-9 ]+")


def _norm(s: str) -> list[str]:
    return _WORD_RE.sub(" ", (s or "").lower()).split()


def _user_settings(db: Session, user_id: int) -> Settings | None:
    return db.scalar(select(Settings).where(Settings.user_id == user_id))


def available_providers() -> dict:
    cfg = get_settings()
    return {
        "default": cfg.ai_provider,
        "providers": {
            "ollama": {
                "configured": bool(cfg.ollama_url),
                "model": cfg.ollama_model,
            },
            "claude": {
                "configured": bool(cfg.claude_api_key),
                "model": cfg.claude_model,
            },
        },
    }


def _resolve(db: Session, user: User) -> tuple[Provider, str]:
    cfg = get_settings()
    s = _user_settings(db, user.id)
    provider = (s.ai_provider if s and s.ai_provider else cfg.ai_provider) or "ollama"
    model = s.ai_model if s and s.ai_model else None
    units = (s.units if s and s.units else "kg")
    if provider == "claude":
        return ClaudeProvider(cfg.claude_api_key, model or cfg.claude_model, cfg.ai_timeout), units
    return OllamaProvider(cfg.ollama_url, model or cfg.ollama_model, cfg.ai_timeout), units


def match_exercise(db: Session, user_id: int, name: str) -> tuple[int | None, str]:
    """Match a parsed exercise name to the catalog (global + the user's custom)."""
    rows = db.execute(
        select(Exercise.id, Exercise.name).where(
            (Exercise.owner_id.is_(None)) | (Exercise.owner_id == user_id)
        )
    ).all()
    target = _norm(name)
    if not target:
        return None, "none"
    tstr = " ".join(target)
    tset = set(target)
    best: tuple[int, str, int] | None = None
    for ex_id, ex_name in rows:
        toks = _norm(ex_name)
        if " ".join(toks) == tstr:
            return ex_id, "exact"
        # All target words present in the catalog name -> fuzzy; prefer the shortest name.
        if tset.issubset(set(toks)):
            if best is None or len(toks) < best[2]:
                best = (ex_id, "fuzzy", len(toks))
    if best:
        return best[0], best[1]
    return None, "none"


async def parse_sets(db: Session, user: User, text: str, workout_id: int | None = None) -> dict:
    provider, units = _resolve(db, user)

    hint_names: list[str] = []
    if workout_id is not None:
        hint_names = [
            r[0]
            for r in db.execute(
                select(Exercise.name)
                .join(WorkoutExercise, WorkoutExercise.exercise_id == Exercise.id)
                .where(WorkoutExercise.workout_id == workout_id)
            ).all()
        ]

    t0 = time.monotonic()
    parsed = await provider.parse(text=text, units=units, hint_names=hint_names)
    latency_ms = int((time.monotonic() - t0) * 1000)

    items = []
    for ex in parsed.exercises:
        ex_id, match = match_exercise(db, user.id, ex.exercise)
        items.append(
            {
                "exercise_name": ex.exercise,
                "exercise_id": ex_id,
                "match": match,  # exact | fuzzy | none
                "sets": [s.model_dump() for s in ex.sets],
                "notes": ex.notes,
            }
        )

    return {
        "provider": provider.name,
        "model": provider.model,
        "units": units,
        "latency_ms": latency_ms,
        "items": items,
    }


__all__ = ["available_providers", "parse_sets", "match_exercise", "AIError"]
