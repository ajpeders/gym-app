"""Provider selection, exercise matching, and the parse entrypoints."""
from __future__ import annotations

import json
import re
import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AthleteProfile, Exercise, Settings, User, WorkoutExercise
from . import prompts
from .base import (
    CHECKIN_SCHEMA,
    PARSE_SCHEMA,
    PROGRAM_SCHEMA,
    AIError,
    CheckinResult,
    ParsedProgram,
    ParsedWorkout,
    Provider,
)
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
            "ollama": {"configured": bool(cfg.ollama_url), "model": cfg.ollama_model},
            "claude": {"configured": bool(cfg.claude_api_key), "model": cfg.claude_model},
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
        if tset.issubset(set(toks)):  # all target words present -> fuzzy; prefer shortest name
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
    data = await provider.complete_json(
        system=prompts.system_prompt(units),
        user=prompts.user_prompt(text, hint_names),
        schema=PARSE_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)

    try:
        parsed = ParsedWorkout.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    items = []
    for ex in parsed.exercises:
        ex_id, match = match_exercise(db, user.id, ex.exercise)
        items.append(
            {
                "exercise_name": ex.exercise,
                "exercise_id": ex_id,
                "match": match,
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


async def parse_routine(db: Session, user: User, text: str) -> dict:
    """Parse a multi-day program (notes-app text) into structured routines."""
    provider, units = _resolve(db, user)

    t0 = time.monotonic()
    data = await provider.complete_json(
        system=prompts.routine_system_prompt(units),
        user=prompts.routine_user_prompt(text),
        schema=PROGRAM_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)

    try:
        program = ParsedProgram.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    routines = []
    for r in program.routines:
        exercises = []
        for e in r.exercises:
            ex_id, match = match_exercise(db, user.id, e.exercise)
            exercises.append(
                {
                    "exercise_name": e.exercise,
                    "exercise_id": ex_id,
                    "match": match,
                    "target_sets": e.target_sets,
                    "target_reps": e.target_reps,
                    "target_weight": e.target_weight,
                    "notes": e.notes,
                }
            )
        routines.append(
            {
                "name": r.name,
                "notes": r.notes,
                "rest_day": r.rest_day,
                "exercises": exercises,
            }
        )
    return {
        "provider": provider.name,
        "model": provider.model,
        "units": units,
        "latency_ms": latency_ms,
        "routines": routines,
    }


# --- Athlete memory ---

_PROFILE_FIELDS = (
    "experience_level",
    "goals",
    "injuries",
    "equipment",
    "preferences",
    "notes",
    "session_note",
)


def get_or_create_profile(db: Session, user_id: int) -> AthleteProfile:
    p = db.scalar(select(AthleteProfile).where(AthleteProfile.user_id == user_id))
    if p is None:
        p = AthleteProfile(user_id=user_id)
        db.add(p)
        db.commit()
        db.refresh(p)
    return p


def profile_dict(p: AthleteProfile) -> dict:
    return {f: getattr(p, f) for f in _PROFILE_FIELDS}


def profile_summary(p: AthleteProfile) -> str:
    """Compact natural-language summary for injecting into coach/parse prompts."""
    parts = []
    if p.experience_level:
        parts.append(f"Level: {p.experience_level}.")
    if p.goals:
        parts.append(f"Goals: {p.goals}.")
    if p.injuries:
        parts.append(f"Injuries/limitations: {', '.join(p.injuries)}.")
    if p.equipment:
        parts.append(f"Equipment: {p.equipment}.")
    if p.preferences:
        parts.append(f"Preferences: {p.preferences}.")
    if p.session_note:
        parts.append(f"Today: {p.session_note}.")
    return " ".join(parts)


async def check_in(db: Session, user: User, text: str) -> dict:
    """Update the athlete profile from a natural-language check-in via the AI."""
    provider, _units = _resolve(db, user)
    p = get_or_create_profile(db, user.id)
    current_json = json.dumps(profile_dict(p), ensure_ascii=False)

    t0 = time.monotonic()
    data = await provider.complete_json(
        system=prompts.checkin_system_prompt(),
        user=prompts.checkin_user_prompt(current_json, text),
        schema=CHECKIN_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)

    try:
        result = CheckinResult.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    for f in _PROFILE_FIELDS:
        setattr(p, f, getattr(result, f))
    db.commit()
    db.refresh(p)

    return {
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": latency_ms,
        "acknowledgement": result.acknowledgement,
        "profile": profile_dict(p),
    }


__all__ = [
    "available_providers",
    "parse_sets",
    "parse_routine",
    "match_exercise",
    "get_or_create_profile",
    "profile_dict",
    "profile_summary",
    "check_in",
    "AIError",
]
