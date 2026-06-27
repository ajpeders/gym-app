"""Provider selection, exercise matching, and the parse entrypoints."""
from __future__ import annotations

import json
import re
import time

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    AthleteProfile,
    CoachMessage,
    Exercise,
    Settings,
    User,
    Workout,
    WorkoutExercise,
)
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


def _stem(tok: str) -> str:
    # crude plural strip so "raises" matches "raise", "curls" matches "curl"
    return tok[:-1] if len(tok) > 3 and tok.endswith("s") else tok


def _norm(s: str) -> list[str]:
    return [_stem(t) for t in _WORD_RE.sub(" ", (s or "").lower()).split()]


def _user_settings(db: Session, user_id: int) -> Settings | None:
    return db.scalar(select(Settings).where(Settings.user_id == user_id))


async def list_models(db: Session, user: User) -> dict:
    """Discover which models are installed on the user's (or default) Ollama."""
    cfg = get_settings()
    s = _user_settings(db, user.id)
    url = s.ollama_url if s and s.ollama_url else None
    if not url:
        raise AIError("Add your Ollama server URL in Settings first.")
    url = url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise AIError(f"Could not reach Ollama at {url}: {exc!r}") from exc
    models = [
        {"name": m.get("name"), "size": m.get("details", {}).get("parameter_size")}
        for m in data.get("models", [])
        if m.get("name") and "embed" not in (m.get("name") or "")
    ]
    s = _user_settings(db, user.id)
    current = (s.ai_model if s and s.ai_model else None) or cfg.ollama_model
    return {"provider": "ollama", "url": url, "current": current, "models": models}


async def test_provider(db: Session, user: User) -> dict:
    """Quick round-trip to confirm the user's active provider/model responds."""
    provider, _units = _resolve(db, user)
    t0 = time.monotonic()
    reply = await provider.complete_text(
        system="You are a connectivity check. Reply with one short word.",
        messages=[{"role": "user", "content": "Reply with exactly: ready"}],
    )
    return {
        "ok": True,
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": int((time.monotonic() - t0) * 1000),
        "sample": reply[:80],
    }


def available_providers(db: Session, user: User) -> dict:
    cfg = get_settings()
    s = _user_settings(db, user.id)
    provider = (s.ai_provider if s and s.ai_provider else cfg.ai_provider) or "ollama"
    ollama_configured = bool(s and s.ollama_url)
    claude_configured = bool(cfg.claude_api_key)
    configured = claude_configured if provider == "claude" else ollama_configured
    return {
        "default": cfg.ai_provider,
        "provider": provider,
        "configured": configured,  # is the user's active provider usable?
        "suggested_ollama_url": cfg.ollama_url,  # a hint for the setup field, NOT applied
        "providers": {
            "ollama": {
                "configured": ollama_configured,
                "url": (s.ollama_url if s and s.ollama_url else None),
                "model": (s.ai_model if s and s.ai_model else None) or cfg.ollama_model,
            },
            "claude": {"configured": claude_configured, "model": cfg.claude_model},
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
    # No silent default: each user brings their own Ollama. Not set up -> error.
    ollama_url = s.ollama_url if s and s.ollama_url else None
    if not ollama_url:
        raise AIError("Local AI isn't set up yet — add your Ollama server in Settings.")
    return OllamaProvider(ollama_url, model or cfg.ollama_model, cfg.ai_timeout), units


def match_exercise(db: Session, user_id: int, name: str) -> tuple[int | None, str]:
    """Match a parsed exercise name to the catalog (global + the user's custom)."""
    rows = db.execute(
        select(Exercise.id, Exercise.name).where(
            (Exercise.owner_id.is_(None)) | (Exercise.owner_id == user_id)
        )
    ).all()
    target = set(_norm(name))
    if not target:
        return None, "none"
    best: tuple[tuple[int, int], int] | None = None  # ((overlap, -size_diff), ex_id)
    for ex_id, ex_name in rows:
        toks = set(_norm(ex_name))
        if toks == target:
            return ex_id, "exact"
        if not toks:
            continue
        inter = len(target & toks)
        if inter == 0:
            continue
        # accept when one name's words are contained in the other (either direction)
        if target <= toks or toks <= target:
            score = (inter, -abs(len(toks) - len(target)))
            if best is None or score > best[0]:
                best = (score, ex_id)
    if best:
        return best[1], "fuzzy"
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


# --- Coach (per-user, grounded in memory + history + past chats) ---


def _recent_training_summary(db: Session, user_id: int, limit: int = 6) -> str:
    workouts = db.scalars(
        select(Workout)
        .where(Workout.owner_id == user_id)
        .order_by(Workout.started_at.desc())
        .limit(limit)
    ).all()
    lines = []
    for w in workouts:
        parts = []
        for we in w.exercises:
            ex_name = we.exercise.name if we.exercise else "?"
            sets = list(we.sets)
            if sets:
                best = max(sets, key=lambda s: (s.weight or 0))
                load = "bw" if best.weight is None else f"{best.weight:g}"
                parts.append(f"{ex_name} {len(sets)}x{best.reps or '?'}@{load}")
            else:
                parts.append(ex_name)
        date = w.started_at.strftime("%b %d") if w.started_at else "?"
        label = w.name or "Workout"
        lines.append(f"- {date} {label}: " + "; ".join(parts[:8]))
    return "\n".join(lines)


def _recent_coach_messages(db: Session, user_id: int, limit: int = 10) -> list[dict]:
    rows = db.scalars(
        select(CoachMessage)
        .where(CoachMessage.user_id == user_id)
        .order_by(CoachMessage.created_at.desc())
        .limit(limit)
    ).all()
    return [{"role": m.role, "content": m.content} for m in reversed(rows)]


def coach_history(db: Session, user_id: int, limit: int = 50) -> list[dict]:
    rows = db.scalars(
        select(CoachMessage)
        .where(CoachMessage.user_id == user_id)
        .order_by(CoachMessage.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
        for m in reversed(rows)
    ]


async def coach(db: Session, user: User, message: str) -> dict:
    provider, _units = _resolve(db, user)
    profile = get_or_create_profile(db, user.id)
    system = prompts.coach_system_prompt(
        user.display_name,
        profile_summary(profile),
        _recent_training_summary(db, user.id),
    )
    convo = _recent_coach_messages(db, user.id) + [{"role": "user", "content": message}]

    t0 = time.monotonic()
    reply = await provider.complete_text(system=system, messages=convo)
    latency_ms = int((time.monotonic() - t0) * 1000)

    db.add(CoachMessage(user_id=user.id, role="user", content=message))
    db.add(CoachMessage(user_id=user.id, role="assistant", content=reply))
    db.commit()

    return {
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": latency_ms,
        "reply": reply,
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
    "coach",
    "coach_history",
    "AIError",
]
