"""Provider selection, exercise matching, and the parse entrypoints."""
from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator

import httpx
from companion import AnthropicProvider, Message, OllamaProvider, Provider
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    AthleteProfile,
    CoachMessage,
    Exercise,
    Session as SessionModel,
    SessionExercise,
    Settings,
    User,
)
from . import prompts
from .base import (
    CHECKIN_SCHEMA,
    EDIT_SPLIT_SCHEMA,
    EDIT_WORKOUT_SCHEMA,
    PARSE_SCHEMA,
    PROGRAM_SCHEMA,
    AIError,
    CheckinResult,
    EditedSplit,
    EditedWorkout,
    ParsedProgram,
    ParsedSession,
)

_WORD_RE = re.compile(r"[^a-z0-9 ]+")


def _stem(tok: str) -> str:
    """Crude singular/plural normalizer so 'raises'/'raise', 'crunches'/'crunch',
    'presses'/'press' unify to the same token."""
    if len(tok) <= 3:
        return tok
    if tok.endswith("ies"):  # flies -> fly
        return tok[:-3] + "y"
    if tok.endswith(("sses", "shes", "ches", "xes", "zzes")):  # presses -> press, crunches -> crunch
        return tok[:-2]
    if tok.endswith("s") and not tok.endswith("ss"):  # raises -> raise, curls -> curl
        tok = tok[:-1]
    if tok == "flye":  # flyes/flys/fly all unify ("Dumbbell Flyes" vs "Cable Fly")
        return "fly"
    return tok


# Adjacent token pairs fused into one token on BOTH sides, because the catalog
# itself is inconsistent ("Pullups" vs "Chin-Up" vs "Weighted Pull Ups") and
# {pull, up} shares nothing with {pullup}.
_FUSED_PAIRS = {
    ("pull", "up"): "pullup",
    ("pull", "ups"): "pullup",  # 'ups' is too short for the plural stemmer
    ("chin", "up"): "chinup",
    ("chin", "ups"): "chinup",
    ("push", "up"): "pushup",
    ("push", "ups"): "pushup",
}


def _fuse(toks: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(toks):
        if i + 1 < len(toks) and (toks[i], toks[i + 1]) in _FUSED_PAIRS:
            out.append(_FUSED_PAIRS[(toks[i], toks[i + 1])])
            i += 2
        else:
            out.append(toks[i])
            i += 1
    return out


# Noise words that carry no matching signal — dropped so token-overlap focuses
# on the meaningful parts of a name.
_STOPWORDS = frozenset({"the", "a", "an", "with", "and", "to", "of", "for", "your"})

# Single-token abbreviation expansions (applied to query names only).
_ABBREV = {
    "db": "dumbbell",
    "bb": "barbell",
    "ohp": "overhead press",
    "rdl": "romanian deadlift",
    "sldl": "stiff leg deadlift",
    "bw": "bodyweight",
}

# Phrase-level synonyms applied to a query name before tokenizing, so
# AI/imported names resolve to a real catalog entry (with images) instead of
# spawning an image-less custom. Kept deliberately small + high-confidence.
_PHRASE_SYNONYMS = [
    ("dumbbell chest press", "dumbbell bench press"),
    ("chest press", "bench press"),
    ("chest fly", "chest fly"),  # guard: keep flyes as-is, not "bench fly"
]


def _norm(s: str) -> list[str]:
    """Catalog-side normalization: stem + drop stopwords. No synonym rewriting,
    so the catalog vocabulary stays untouched."""
    return _fuse(
        [
            t
            for t in (_stem(w) for w in _WORD_RE.sub(" ", (s or "").lower()).split())
            if t and t not in _STOPWORDS
        ]
    )


# Whole-name synonyms (query side, keyed on the stemmed token string): common
# gym names whose token overlap alone lands on the wrong catalog variant
# ('Lateral Raises' -> 'Lateral Raise - With Bands'). Whole-name keys can't
# accidentally rewrite parts of longer, more specific names.
_NAME_SYNONYMS = {
    "flat dumbbell press": "dumbbell bench press",
    "flat dumbbell bench press": "dumbbell bench press",
    "cable fly": "cable crossover",
    "lateral raise": "side lateral raise",
    "dumbbell lateral raise": "side lateral raise",
    "lat pulldown": "wide grip lat pulldown",
    "leg curl machine": "seated leg curl",
    "leg curl": "seated leg curl",
}


def _norm_query(s: str) -> list[str]:
    """Query-side normalization for names coming from the AI or an import:
    apply phrase synonyms + abbreviation expansion on top of :func:`_norm` so
    'flat dumbbell chest press' lands on 'Dumbbell Bench Press'."""
    text = (s or "").lower()
    for phrase, repl in _PHRASE_SYNONYMS:
        if phrase == repl:
            continue
        text = text.replace(phrase, repl)
    toks: list[str] = []
    for w in _WORD_RE.sub(" ", text).split():
        for part in _ABBREV.get(w, w).split():
            t = _stem(part)
            if t and t not in _STOPWORDS:
                toks.append(t)
    toks = _fuse(toks)
    canonical = _NAME_SYNONYMS.get(" ".join(toks))
    if canonical is not None:
        toks = _norm(canonical)
    return toks


def _user_settings(db: Session, user_id: int) -> Settings | None:
    return db.scalar(select(Settings).where(Settings.user_id == user_id))


def _normalize_url(url: str | None) -> str:
    url = (url or "").strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        url = "http://" + url  # tolerate "host:11434" without a scheme
    return url


def _effective_provider(s: Settings | None, cfg) -> str:
    return (s.ai_provider if s and s.ai_provider else cfg.ai_provider) or "ollama"


def _provider_configured(s: Settings | None, provider: str) -> bool:
    """Single source of truth for 'is this provider usable for this user' — matches
    exactly what _resolve requires (whitespace-only values are NOT configured)."""
    if provider == "claude":
        return bool(s and s.claude_api_key and s.claude_api_key.strip())
    return bool(s and s.ollama_url and _normalize_url(s.ollama_url))


def _ollama_model(s: Settings | None, cfg) -> str:
    return (s.ollama_model if s and s.ollama_model else None) or cfg.ollama_model


def _claude_model(s: Settings | None, cfg) -> str:
    return (s.claude_model if s and s.claude_model else None) or cfg.claude_model


async def list_models(db: Session, user: User) -> dict:
    """Discover which models are installed on the user's Ollama."""
    cfg = get_settings()
    s = _user_settings(db, user.id)
    if not _provider_configured(s, "ollama"):
        raise AIError("Add your Ollama server URL in Settings first.")
    url = _normalize_url(s.ollama_url)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
        models = [
            {"name": m.get("name"), "size": (m.get("details") or {}).get("parameter_size")}
            for m in (data.get("models") or [])
            if m.get("name") and "embed" not in (m.get("name") or "")
        ]
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
        raise AIError(f"Could not reach Ollama at {url}: {exc!r}") from exc
    return {"provider": "ollama", "url": url, "current": _ollama_model(s, cfg), "models": models}


async def test_provider(db: Session, user: User) -> dict:
    """Quick round-trip to confirm the user's active provider/model responds."""
    provider, _units = _resolve(db, user)
    t0 = time.monotonic()
    completion = await provider.complete_text(
        system="You are a connectivity check. Reply with one short word.",
        messages=[Message(role="user", content="Reply with exactly: ready")],
    )
    return {
        "ok": True,
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": int((time.monotonic() - t0) * 1000),
        "sample": completion.text[:80],
    }


def available_providers(db: Session, user: User) -> dict:
    cfg = get_settings()
    s = _user_settings(db, user.id)
    provider = _effective_provider(s, cfg)
    ollama_configured = _provider_configured(s, "ollama")
    claude_configured = _provider_configured(s, "claude")
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
                "model": _ollama_model(s, cfg),
            },
            "claude": {"configured": claude_configured, "model": _claude_model(s, cfg)},
        },
    }


def _resolve(db: Session, user: User) -> tuple[Provider, str]:
    cfg = get_settings()
    s = _user_settings(db, user.id)
    provider = _effective_provider(s, cfg)
    units = (s.units if s and s.units else "kg")
    if provider == "claude":
        if not _provider_configured(s, "claude"):
            raise AIError("Claude isn't set up yet — add your API key in Settings.")
        p = AnthropicProvider(
            api_key=s.claude_api_key.strip(), model=_claude_model(s, cfg), timeout=cfg.ai_timeout
        )
        p.name = "claude"  # gym's historical label (shown in the UI footer)
        return p, units
    # No silent default: each user brings their own Ollama. Not set up -> error.
    if not _provider_configured(s, "ollama"):
        raise AIError("Local AI isn't set up yet — add your Ollama server in Settings.")
    return (
        OllamaProvider(
            base_url=_normalize_url(s.ollama_url), model=_ollama_model(s, cfg), timeout=cfg.ai_timeout
        ),
        units,
    )


CatalogEntry = tuple[int, str, frozenset[str]]


def _load_catalog(db: Session, user_id: int) -> list[CatalogEntry]:
    """Load the exercise catalog (global + the user's custom) once, normalized."""
    rows = db.execute(
        select(Exercise.id, Exercise.name).where(
            (Exercise.owner_id.is_(None)) | (Exercise.owner_id == user_id)
        )
    ).all()
    return [(ex_id, ex_name, frozenset(_norm(ex_name))) for ex_id, ex_name in rows]


def _match(
    name: str, catalog: list[CatalogEntry]
) -> tuple[int | None, str, str | None]:
    target = frozenset(_norm_query(name))
    if not target:
        return None, "none", None
    best_key: tuple = ()
    best_id: int | None = None
    best_name: str | None = None
    fb_key: tuple = ()
    fb_id: int | None = None
    fb_name: str | None = None
    for ex_id, ex_name, toks in catalog:
        if toks == target:
            return ex_id, "exact", ex_name
        if not toks:
            continue
        inter = len(target & toks)
        if inter == 0:
            continue
        subset = target <= toks or toks <= target
        if subset:
            # deterministic ranking: most overlap, closest size, shortest, lowest id
            key = (inter, -abs(len(toks) - len(target)), -len(toks), -ex_id)
            if best_id is None or key > best_key:
                best_key, best_id, best_name = key, ex_id, ex_name
        else:
            # Conservative fuzzy fallback: strong two-sided overlap even when
            # neither name fully contains the other (e.g. an extra qualifier on
            # each side). Requires >=2 shared tokens covering most of the
            # shorter name, so unrelated moves don't collide.
            shorter = min(len(target), len(toks))
            if inter >= 2 and inter >= shorter - 1:
                key = (inter, -abs(len(toks) - len(target)), -len(toks), -ex_id)
                if fb_id is None or key > fb_key:
                    fb_key, fb_id, fb_name = key, ex_id, ex_name
    if best_id is not None:
        return best_id, "fuzzy", best_name
    return (fb_id, "fuzzy", fb_name) if fb_id is not None else (None, "none", None)


def match_exercise(db: Session, user_id: int, name: str) -> tuple[int | None, str]:
    """Match a single parsed exercise name to the catalog (loads the catalog)."""
    ex_id, match, _ = _match(name, _load_catalog(db, user_id))
    return ex_id, match


async def parse_sets(db: Session, user: User, text: str, workout_id: int | None = None) -> dict:
    provider, units = _resolve(db, user)

    hint_names: list[str] = []
    if workout_id is not None:
        hint_names = [
            r[0]
            for r in db.execute(
                select(Exercise.name)
                .join(SessionExercise, SessionExercise.exercise_id == Exercise.id)
                .where(SessionExercise.session_id == workout_id)
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
        parsed = ParsedSession.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    catalog = _load_catalog(db, user.id)
    items = []
    for ex in parsed.exercises:
        ex_id, match, matched_name = _match(ex.exercise, catalog)
        items.append(
            {
                "exercise_name": ex.exercise,
                "exercise_id": ex_id,
                "matched_name": matched_name,
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


def _normalize_rep_range(
    lo: int | None, hi: int | None
) -> tuple[int | None, int | None]:
    """Coerce a model's (low, high) rep target into a sane pair.

    Small local models are inconsistent — they'll emit only the high end, or
    flip the order. Guarantees: a lone value lives in ``lo``; ``lo <= hi``; and
    a degenerate range (hi == lo) collapses to a single value (hi = None).
    """
    if lo is None and hi is not None:
        lo, hi = hi, None
    if lo is not None and hi is not None:
        if hi < lo:
            lo, hi = hi, lo
        if hi == lo:
            hi = None
    return lo, hi


def _normalize_number_range(
    lo: int | float | None, hi: int | float | None
) -> tuple[int | float | None, int | float | None]:
    """Normalize an optional numeric low/high pair without discarding ranges."""
    if lo is None and hi is not None:
        lo, hi = hi, None
    if lo is not None and hi is not None:
        if hi < lo:
            lo, hi = hi, lo
        if hi == lo:
            hi = None
    return lo, hi


def _primary_exercise(name: str, notes: str | None) -> tuple[str, str | None]:
    """Use the first slash-separated movement as the loggable catalog exercise.

    Imported plans often use ``A / B`` to mean a substitution. The workout
    model owns one exercise per slot, so retain B as a note instead of creating
    an unmatchable combined exercise named ``A / B``.
    """
    parts = [part.strip() for part in re.split(r"\s+/\s+", name) if part.strip()]
    if len(parts) < 2:
        return name.strip(), notes
    primary = parts[0]
    alternative = " / ".join(parts[1:])
    alternative_note = f"Alternative: {alternative}"
    existing = (notes or "").strip()
    if alternative.lower() in existing.lower():
        return primary, existing or None
    return primary, f"{alternative_note}\n{existing}".strip()


def _build_workout_result(
    db: Session,
    user_id: int,
    provider: Provider,
    units: str,
    latency_ms: int,
    data: dict,
) -> dict:
    """Validate raw model output + resolve each exercise against the catalog."""
    try:
        program = ParsedProgram.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    catalog = _load_catalog(db, user_id)
    workouts = []
    for r in program.workouts:
        exercises = []
        for e in r.exercises:
            exercise_name, exercise_notes = _primary_exercise(e.exercise, e.notes)
            ex_id, match, matched_name = _match(exercise_name, catalog)
            reps_lo, reps_hi = _normalize_rep_range(e.target_reps, e.target_reps_max)
            weight_lo, weight_hi = _normalize_number_range(
                e.target_weight, e.target_weight_max
            )
            duration_lo, duration_hi = _normalize_number_range(
                e.target_duration_seconds, e.target_duration_seconds_max
            )
            exercises.append(
                {
                    "exercise_name": exercise_name,
                    "exercise_id": ex_id,
                    "matched_name": matched_name,
                    "match": match,
                    "target_sets": e.target_sets,
                    "target_reps": reps_lo,
                    "target_reps_max": reps_hi,
                    "target_weight": weight_lo,
                    "target_weight_max": weight_hi,
                    "target_duration_seconds": duration_lo,
                    "target_duration_seconds_max": duration_hi,
                    "notes": exercise_notes,
                }
            )
        workouts.append(
            {
                "name": r.name,
                "notes": r.notes,
                "rest_day": r.rest_day,
                "weekdays": r.weekdays,
                "floating": r.floating,
                "optional": r.optional,
                "exercises": exercises,
            }
        )
    return {
        "provider": provider.name,
        "model": provider.model,
        "units": units,
        "latency_ms": latency_ms,
        "name": program.name,
        "notes": program.notes,
        "rules": program.rules,
        "workouts": workouts,
    }


_DAY_NAMES = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}


def _infer_schedule_from_name(name: str) -> tuple[list[int], bool, bool]:
    lower = name.lower()
    days = [value for day, value in _DAY_NAMES.items() if day in lower]
    optional = "optional" in lower
    floating = optional and not days
    return sorted(set(days)), floating, optional


def _patch_program_schedule(data: dict) -> dict:
    """Backfill schedule fields from headings if the model omits them."""
    workouts = data.get("workouts")
    if not isinstance(workouts, list):
        return data
    for workout in workouts:
        if not isinstance(workout, dict):
            continue
        name = str(workout.get("name") or "")
        inferred_days, inferred_floating, inferred_optional = _infer_schedule_from_name(name)
        if not workout.get("weekdays") and inferred_days:
            workout["weekdays"] = inferred_days
        if inferred_optional:
            workout["optional"] = True
            if not inferred_days:
                workout["floating"] = True
        else:
            workout.setdefault("floating", inferred_floating)
            workout.setdefault("optional", False)
    return data


async def parse_workout(db: Session, user: User, text: str) -> dict:
    """Parse a multi-day program (notes-app text) into structured workouts."""
    provider, units = _resolve(db, user)

    t0 = time.monotonic()
    data = await provider.complete_json(
        system=prompts.workout_system_prompt(units),
        user=prompts.workout_user_prompt(text),
        schema=PROGRAM_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    return _build_workout_result(db, user.id, provider, units, latency_ms, _patch_program_schedule(data))


async def parse_workout_stream(
    db: Session, user: User, text: str
) -> AsyncIterator[dict]:
    """Streaming variant of :func:`parse_workout`.

    Yields ``{"type": "progress", "received": N}`` while the model generates,
    then one ``{"type": "result", ...}`` carrying the same payload
    :func:`parse_workout` returns. Providers without a ``stream_json`` method
    (e.g. Claude) fall back to a single blocking call with no progress events.
    """
    provider, units = _resolve(db, user)
    t0 = time.monotonic()

    data: dict | None = None
    stream = getattr(provider, "stream_json", None)
    if stream is not None:
        async for ev in stream(
            system=prompts.workout_system_prompt(units),
            user=prompts.workout_user_prompt(text),
            schema=PROGRAM_SCHEMA,
        ):
            if ev.get("type") == "progress":
                yield ev
            elif ev.get("type") == "result":
                data = ev.get("data")
    else:
        data = await provider.complete_json(
            system=prompts.workout_system_prompt(units),
            user=prompts.workout_user_prompt(text),
            schema=PROGRAM_SCHEMA,
        )

    if data is None:
        raise AIError("The AI returned no result.")

    latency_ms = int((time.monotonic() - t0) * 1000)
    result = _build_workout_result(db, user.id, provider, units, latency_ms, _patch_program_schedule(data))
    yield {"type": "result", **result}


async def edit_workout_stream(
    db: Session, user: User, working: dict, instruction: str
) -> AsyncIterator[dict]:
    """Conversationally edit ONE workout.

    ``working`` is the workout as it currently stands on the client (exercises by
    name, so the model can reason about them); ``instruction`` is the user's
    latest request. Yields ``progress`` events while the model generates, then a
    single ``result`` event carrying the proposed workout with each exercise
    resolved against the catalog. Nothing is persisted here — the client reviews
    the proposal and saves via the normal workout update path.
    """
    provider, units = _resolve(db, user)
    workout_json = json.dumps(working, ensure_ascii=False)
    system = prompts.edit_workout_system_prompt(units)
    user_prompt = prompts.edit_workout_user_prompt(workout_json, instruction)
    t0 = time.monotonic()

    data: dict | None = None
    stream = getattr(provider, "stream_json", None)
    if stream is not None:
        async for ev in stream(system=system, user=user_prompt, schema=EDIT_WORKOUT_SCHEMA):
            if ev.get("type") == "progress":
                yield ev
            elif ev.get("type") == "result":
                data = ev.get("data")
    else:
        data = await provider.complete_json(
            system=system, user=user_prompt, schema=EDIT_WORKOUT_SCHEMA
        )

    if data is None:
        raise AIError("The AI returned no result.")

    try:
        edited = EditedWorkout.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    catalog = _load_catalog(db, user.id)
    exercises = []
    for e in edited.exercises:
        exercise_name, exercise_notes = _primary_exercise(e.exercise, e.notes)
        ex_id, match, matched_name = _match(exercise_name, catalog)
        reps_lo, reps_hi = _normalize_rep_range(e.target_reps, e.target_reps_max)
        weight_lo, weight_hi = _normalize_number_range(e.target_weight, e.target_weight_max)
        duration_lo, duration_hi = _normalize_number_range(
            e.target_duration_seconds, e.target_duration_seconds_max
        )
        exercises.append(
            {
                "exercise_name": exercise_name,
                "exercise_id": ex_id,
                "matched_name": matched_name,
                "match": match,
                "target_sets": e.target_sets,
                "target_reps": reps_lo,
                "target_reps_max": reps_hi,
                "target_weight": weight_lo,
                "target_weight_max": weight_hi,
                "target_duration_seconds": duration_lo,
                "target_duration_seconds_max": duration_hi,
                "notes": exercise_notes,
            }
        )
    latency_ms = int((time.monotonic() - t0) * 1000)
    yield {
        "type": "result",
        "provider": provider.name,
        "model": provider.model,
        "units": units,
        "latency_ms": latency_ms,
        "reply": edited.reply,
        "name": edited.name,
        "notes": edited.notes,
        "exercises": exercises,
    }


async def edit_split_stream(
    db: Session, user: User, working: dict, instruction: str
) -> AsyncIterator[dict]:
    """Conversationally edit ONE split's shape: name, notes, progression rules,
    and which day sits on which weekday.

    ``working`` carries each day with its real workout id so the proposal can be
    matched back to rows; the model is told to echo ids unchanged. Exercises
    inside a day are out of scope here — :func:`edit_workout_stream` owns those.
    Nothing is persisted; the client reviews and saves via the normal routes.
    """
    provider, _units = _resolve(db, user)
    split_json = json.dumps(working, ensure_ascii=False)
    system = prompts.edit_split_system_prompt()
    user_prompt = prompts.edit_split_user_prompt(split_json, instruction)
    t0 = time.monotonic()

    data: dict | None = None
    stream = getattr(provider, "stream_json", None)
    if stream is not None:
        async for ev in stream(system=system, user=user_prompt, schema=EDIT_SPLIT_SCHEMA):
            if ev.get("type") == "progress":
                yield ev
            elif ev.get("type") == "result":
                data = ev.get("data")
    else:
        data = await provider.complete_json(
            system=system, user=user_prompt, schema=EDIT_SPLIT_SCHEMA
        )

    if data is None:
        raise AIError("The AI returned no result.")

    try:
        edited = EditedSplit.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    known_ids = {d.get("id") for d in (working.get("days") or []) if d.get("id") is not None}
    days = []
    for d in edited.days:
        # A floating day isn't pinned anywhere; drop weekdays the model left on
        # it so the two fields can't contradict each other.
        weekdays = [] if d.floating else sorted({w for w in d.weekdays if 0 <= w <= 6})
        days.append(
            {
                # An id the split doesn't own (a hallucinated one) is treated as
                # a new day rather than silently retargeting someone's workout.
                "id": d.id if d.id in known_ids else None,
                "name": d.name,
                "weekdays": weekdays,
                "floating": d.floating,
            }
        )

    latency_ms = int((time.monotonic() - t0) * 1000)
    yield {
        "type": "result",
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": latency_ms,
        "reply": edited.reply,
        "name": edited.name,
        "notes": edited.notes,
        "rules": edited.rules,
        "days": days,
    }


# --- Athlete memory ---

_PROFILE_FIELDS = (
    "experience_level",
    "height",
    "current_weight",
    "goal_weight",
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
    if p.height:
        parts.append(f"Height: {p.height}.")
    if p.current_weight:
        parts.append(f"Current weight: {p.current_weight}.")
    if p.goal_weight:
        parts.append(f"Goal weight: {p.goal_weight}.")
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
    sessions = db.scalars(
        select(SessionModel)
        .where(SessionModel.owner_id == user_id)
        .order_by(SessionModel.started_at.desc())
        .limit(limit)
    ).all()
    lines = []
    for w in sessions:
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
    convo = [
        Message(role=m["role"], content=m["content"])
        for m in _recent_coach_messages(db, user.id)
    ] + [Message(role="user", content=message)]

    t0 = time.monotonic()
    completion = await provider.complete_text(system=system, messages=convo)
    reply = completion.text
    if not reply:
        raise AIError("The AI returned an empty reply.")
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
    "parse_workout",
    "edit_workout_stream",
    "edit_split_stream",
    "match_exercise",
    "get_or_create_profile",
    "profile_dict",
    "profile_summary",
    "check_in",
    "coach",
    "coach_history",
    "AIError",
]
