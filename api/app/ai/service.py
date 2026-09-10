"""Provider selection, exercise matching, and the parse entrypoints."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime
from collections.abc import AsyncIterator

import httpx
from companion import AnthropicProvider, Message, OllamaProvider, OpenAICompatibleProvider, Provider, Tool
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..schemas import LoggedExerciseIn, LoggedSetIn, SessionLog
from ..seed.tracking import TIME, infer_tracking_type
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
from .. import set_parse
from .base import (
    CHECKIN_SCHEMA,
    EDIT_SPLIT_SCHEMA,
    EDIT_WORKOUT_SCHEMA,
    NUTRITION_SCHEMA,
    PARSE_DAYS_SCHEMA,
    PARSE_SCHEMA,
    PROGRAM_SCHEMA,
    AIError,
    CheckinResult,
    ParsedExercise,
    EditedSplit,
    EditedWorkout,
    ParsedDays,
    ParsedNutrition,
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
    ("cross", "over"): "crossover",  # wger "Cable Cross-over" vs "Cable Crossover"
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
    # Terse shorthand. Token overlap alone prefers the catalog name closest in
    # length, so a bare "bench" lands on "Bench Dips" — a triceps movement.
    "bench": "barbell bench press",
    "squat": "barbell squat",
    "flat dumbbell press": "dumbbell bench press",
    "flat dumbbell bench press": "dumbbell bench press",
    "cable fly": "cable crossover",
    "lateral raise": "side lateral raise",
    # Keeps 'dumbbell', so the equipment guard can reject a machine variant.
    # Rewriting it away used to send this straight to "Machine Side Lateral Raises".
    "dumbbell lateral raise": "dumbbell side lateral raise",
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


# Tokens that *contradict* rather than merely qualify. Overlap scoring treats a
# missing word as a small penalty, which is wrong for these: a decline press is
# not a flat one and a crunch is not a back extension. All entries are already
# stemmed (`raises` -> `raise`, `extensions` -> `extension`).
_EQUIPMENT = frozenset(
    {
        "dumbbell", "barbell", "cable", "machine", "band", "smith", "kettlebell",
        "bodyweight", "lever", "leverage", "trx", "sled", "ezbar",
    }
)
_ANGLE = frozenset({"flat", "incline", "decline"})
# What the movement is done to (or on). Without this, "Dumbbell Bench Press"
# and "Shoulder Press, Dumbbells" look like near-neighbours: both press, both
# dumbbell, differing only in a word overlap scoring is happy to forgive.
_TARGETS = frozenset(
    {
        "bench", "shoulder", "chest", "leg", "calf", "tricep", "bicep", "back",
        "lat", "ab", "glute", "hamstring", "quad", "forearm", "wrist", "neck",
        "hip", "trap", "delt",
    }
)
_MOVEMENTS = frozenset(
    {
        "press", "curl", "row", "raise", "fly", "crossover", "crunch", "extension",
        "squat", "deadlift", "pulldown", "pullover", "lunge", "dip", "pushup",
        "pullup", "chinup", "shrug", "plank", "thrust", "pushdown", "situp",
        "bridge", "kickback",
    }
)


def _contradicts(target: frozenset[str], toks: frozenset[str]) -> bool:
    """True when a candidate names something the query rules out."""
    # An angle is never optional: matching "Flat Dumbbell Press" to a decline
    # press is worse than offering to create it as a custom exercise.
    if (toks & _ANGLE) - target:
        return True
    for group in (_EQUIPMENT, _MOVEMENTS, _TARGETS):
        mine, theirs = target & group, toks & group
        if mine and theirs and not (mine & theirs):
            return True
    return False


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
    if provider == "openai":
        return bool(s and s.openai_api_key and s.openai_api_key.strip())
    return bool(s and s.ollama_url and _normalize_url(s.ollama_url))


def _ollama_model(s: Settings | None, cfg) -> str:
    return (s.ollama_model if s and s.ollama_model else None) or cfg.ollama_model


def _claude_model(s: Settings | None, cfg) -> str:
    return (s.claude_model if s and s.claude_model else None) or cfg.claude_model


def _openai_model(s: Settings | None, cfg) -> str:
    return (s.openai_model if s and s.openai_model else None) or cfg.openai_model


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


def _walk_values(value):
    if isinstance(value, dict):
        for v in value.values():
            yield from _walk_values(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk_values(v)
    else:
        yield value


def _count_probe_sets(args: dict) -> int:
    """Best-effort score for whether `3x5` became three explicit sets."""
    count = 0
    for value in _walk_values(args):
        if isinstance(value, (int, float)) and int(value) == 5:
            count += 1
    for value in args.values():
        if isinstance(value, list):
            count = max(count, len(value))
    return count


async def check_model(db: Session, user: User) -> dict:
    """Probe the active provider/model with fake tools and score observed failures.

    This deliberately does not call gym's real tools or write user data. The
    provider only sees an artificial tool surface that mirrors the spotter's
    two core jobs: look things up before writing, then expand a terse set log.
    """
    provider, _units = _resolve(db, user)
    tools = [
        Tool(
            name="search_exercise",
            description="Search the exercise catalog by name before logging a set.",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="log_sets",
            description="Log sets only after an exercise id has been found.",
            parameters={
                "type": "object",
                "properties": {
                    "exercise_id": {"type": "integer"},
                    "sets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "reps": {"type": "integer"},
                                "weight": {"type": "number"},
                            },
                            "required": ["reps", "weight"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["exercise_id", "sets"],
                "additionalProperties": False,
            },
        ),
    ]
    t0 = time.monotonic()
    try:
        completion = await provider.complete_text(
            system=(
                "You are testing whether a gym logging model can use tools. "
                "Use tools only. Search for the exercise before logging. "
                "Do not invent an exercise_id; if you do not know it, search first."
            ),
            messages=[
                Message(
                    role="user",
                    content="Log squat 3x5 at 100kg. Use the catalog instead of guessing ids.",
                )
            ],
            tools=tools,
        )
    except Exception as exc:  # noqa: BLE001 - provider-specific failures are the signal here
        latency_ms = int((time.monotonic() - t0) * 1000)
        return {
            "provider": provider.name,
            "model": provider.model,
            "latency_ms": latency_ms,
            "verdict": "not_suitable",
            "summary": "The model rejected or failed the tool-calling probe.",
            "checks": [
                {
                    "key": "tool_calling",
                    "label": "Tool calling",
                    "passed": False,
                    "detail": str(exc),
                }
            ],
        }

    latency_ms = int((time.monotonic() - t0) * 1000)
    calls = completion.tool_calls
    names = [c.name for c in calls]
    search_call = next((c for c in calls if c.name == "search_exercise"), None)
    log_call = next((c for c in calls if c.name == "log_sets"), None)
    set_count = _count_probe_sets(log_call.arguments if log_call else {})
    guessed_id = bool(log_call and log_call.arguments.get("exercise_id") is not None and not search_call)

    checks = [
        {
            "key": "tool_calling",
            "label": "Tool calling",
            "passed": bool(calls),
            "detail": f"{len(calls)} tool call(s): {', '.join(names) if names else 'none'}",
        },
        {
            "key": "id_resolution",
            "label": "Looks up exercise ids",
            "passed": search_call is not None,
            "detail": "Called search_exercise before logging" if search_call else "Did not search the catalog",
        },
        {
            "key": "set_expansion",
            "label": "Expands 3x5",
            "passed": set_count >= 3,
            "detail": f"Detected {set_count} set-like item(s)",
        },
        {
            "key": "argument_discipline",
            "label": "Doesn't invent ids",
            "passed": not guessed_id,
            "detail": "No guessed id before search" if not guessed_id else "Logged with an id before searching",
        },
    ]
    passed = sum(1 for c in checks if c["passed"])
    verdict = "recommended" if passed == len(checks) else "parsing_only" if passed >= 2 else "not_suitable"
    return {
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": latency_ms,
        "verdict": verdict,
        "summary": f"Passed {passed}/{len(checks)} spotter capability checks.",
        "checks": checks,
    }


def available_providers(db: Session, user: User) -> dict:
    cfg = get_settings()
    s = _user_settings(db, user.id)
    provider = _effective_provider(s, cfg)
    ollama_configured = _provider_configured(s, "ollama")
    claude_configured = _provider_configured(s, "claude")
    openai_configured = _provider_configured(s, "openai")
    configured = (
        claude_configured
        if provider == "claude"
        else openai_configured
        if provider == "openai"
        else ollama_configured
    )
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
            "openai": {"configured": openai_configured, "model": _openai_model(s, cfg)},
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
    if provider == "openai":
        if not _provider_configured(s, "openai"):
            raise AIError("ChatGPT isn't set up yet — add your OpenAI API key in Settings.")
        return (
            OpenAICompatibleProvider(
                base_url=cfg.openai_base_url,
                api_key=s.openai_api_key.strip(),
                model=_openai_model(s, cfg),
                name="openai",
                timeout=cfg.ai_timeout,
            ),
            units,
        )
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
    # An exact catalog name wins before any synonym rewriting. Synonyms exist to
    # rescue a name that doesn't resolve; letting one override a name that does
    # sent "squats" to "Barbell Hack Squats" via the "squat" -> "barbell squat"
    # shorthand, even though the catalog has a plain "Squats".
    raw = frozenset(_norm(name))
    if raw:
        for ex_id, ex_name, toks in catalog:
            if toks == raw:
                return ex_id, "exact", ex_name

    target = frozenset(_norm_query(name))
    if not target:
        return None, "none", None
    best_key: tuple = ()
    best_id: int | None = None
    best_name: str | None = None
    for ex_id, ex_name, toks in catalog:
        if toks == target:
            return ex_id, "exact", ex_name
        if not toks or _contradicts(target, toks):
            continue
        inter = len(target & toks)
        if inter == 0:
            continue
        if not (target <= toks or toks <= target):
            # Neither name contains the other (an extra qualifier on each side).
            # Require >=2 shared tokens covering most of the shorter name, so
            # unrelated movements don't collide.
            shorter = min(len(target), len(toks))
            if not (inter >= 2 and inter >= shorter - 1):
                continue
        # Equipment nobody asked for is the strongest demotion: for a plain
        # "Lateral Raises", "Machine Side Lateral Raises" shares more tokens but
        # is the wrong exercise, so it must lose to bare "Lateral Raises".
        unasked_equipment = len((toks & _EQUIPMENT) - target)
        # Then overlap as a *fraction* of the two names combined, so a subset
        # match on one token stops beating a strong partial one — bare "Row"
        # used to win over "One Arm Bent Row" for "One-Arm Dumbbell Row".
        similarity = inter / len(target | toks)
        key = (-unasked_equipment, similarity, inter, -len(toks), -ex_id)
        if best_id is None or key > best_key:
            best_key, best_id, best_name = key, ex_id, ex_name
    return (best_id, "fuzzy", best_name) if best_id is not None else (None, "none", None)


def match_exercise(db: Session, user_id: int, name: str) -> tuple[int | None, str]:
    """Match a single parsed exercise name to the catalog (loads the catalog)."""
    ex_id, match, _ = _match(name, _load_catalog(db, user_id))
    return ex_id, match


def _local_units(db: Session, user: User) -> str:
    s = _user_settings(db, user.id)
    return s.units if s and s.units else "kg"


async def parse_sets(db: Session, user: User, text: str, workout_id: int | None = None) -> dict:
    # Notation is read by rules, not a model: same answer every time, in
    # milliseconds, and on an account with no AI provider at all. The model is
    # for prose the rules don't recognise.
    local = set_parse.parse_sets_text(text)
    if local:
        catalog = _load_catalog(db, user.id)
        return {
            "provider": "local",
            "model": "rules",
            "units": _local_units(db, user),
            "latency_ms": 0,
            "items": _match_items([ParsedExercise.model_validate(i) for i in local], catalog),
        }

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
    items = _match_items(parsed.exercises, catalog)
    return {
        "provider": provider.name,
        "model": provider.model,
        "units": units,
        "latency_ms": latency_ms,
        "items": items,
    }


def _match_items(exercises, catalog) -> list[dict]:
    """Resolve parsed exercise names against the catalog, preserving order."""
    items = []
    for ex in exercises:
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
    return items


class UnmatchedExercises(AIError):
    """A phrase named a movement the catalog doesn't have.

    Raised instead of logging the rest, because a partial log is silently wrong
    training data — and substituting a near-match is how "squats" became
    "Step Jack". The caller reports the names so the user can rename or create
    the exercise.
    """

    def __init__(self, names: list[str]) -> None:
        self.names = names
        super().__init__(
            "Couldn't find these in the exercise catalog: " + ", ".join(names)
        )


def session_log_from_items(
    items: list[dict],
    name: str | None = None,
    started_at: str | datetime | None = None,
) -> SessionLog:
    """Turn matched parse results into a loggable session.

    All or nothing on matching: the model used to hand-build this payload and
    guess `exercise_id`, so the point of routing through here is that every id
    came from `_match` or the log doesn't happen.
    """
    loggable = [i for i in items if i.get("sets")]
    unmatched = [i["exercise_name"] for i in loggable if not i.get("exercise_id")]
    if unmatched:
        raise UnmatchedExercises(unmatched)
    if not loggable:
        raise UnmatchedExercises([i.get("exercise_name", "?") for i in items] or ["nothing"])

    return SessionLog(
        name=name,
        # Left to the server unless the user actually said when. A model asked
        # for a timestamp will happily invent one two years in the past.
        started_at=started_at,
        exercises=[
            LoggedExerciseIn(
                exercise_id=int(i["exercise_id"]),
                sets=[
                    LoggedSetIn(
                        reps=s.get("reps"),
                        weight=s.get("weight"),
                        rpe=s.get("rpe"),
                        set_type=s.get("set_type") or "working",
                    )
                    for s in i["sets"]
                ],
            )
            for i in loggable
        ],
    )


async def log_text(
    db: Session, user: User, text: str, name: str | None = None,
    started_at: str | None = None,
) -> SessionLog:
    """Parse a phrase like "3x5 squats at 100kg" into a loggable session.

    Exists so the spotter never authors training data itself. It hands over the
    raw phrase; `parse_sets` expands NxM and resolves the movement through
    `_match`. Measured, a 7B model asked to build this payload sent one set
    instead of three and `exercise_id: 1` ("Step Jack") for "squats".
    """
    parsed = await parse_sets(db, user, text)
    return session_log_from_items(parsed["items"], name=name, started_at=started_at)


async def parse_days(db: Session, user: User, text: str) -> dict:
    """Split a multi-day paste into one group of matched sets per day.

    Day labels come back verbatim ("Thu - Push", "Jul 30"); resolving them to
    real dates is the client's job, since only it knows the device's calendar.
    """
    local = set_parse.parse_days_text(text)
    if local:
        catalog = _load_catalog(db, user.id)
        return {
            "provider": "local",
            "model": "rules",
            "units": _local_units(db, user),
            "latency_ms": 0,
            "days": [
                {
                    "day": d["day"],
                    "items": _match_items(
                        [ParsedExercise.model_validate(i) for i in d["exercises"]], catalog
                    ),
                }
                for d in local
            ],
        }

    provider, units = _resolve(db, user)

    t0 = time.monotonic()
    data = await provider.complete_json(
        system=prompts.days_system_prompt(units),
        user=prompts.days_user_prompt(text),
        schema=PARSE_DAYS_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)

    try:
        parsed = ParsedDays.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc

    catalog = _load_catalog(db, user.id)
    days = [
        {"day": d.day, "items": _match_items(d.exercises, catalog)}
        for d in parsed.days
        # A day the model split out but found no exercises in is noise.
        if d.exercises
    ]
    return {
        "provider": provider.name,
        "model": provider.model,
        "units": units,
        "latency_ms": latency_ms,
        "days": days,
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


def _repair_timed_targets(
    name: str,
    reps_lo: int | None,
    reps_hi: int | None,
    dur_lo: float | None,
    dur_hi: float | None,
) -> tuple[int | None, int | None, float | None, float | None]:
    """Move a held movement's seconds out of the rep fields.

    A plan row reads "Dead Hang | 2 | 20-60 seconds"; the model fills the reps
    column because that is the column it is in, and no amount of prompting has
    reliably fixed it. We already infer that a dead hang is timed, so repair it
    deterministically. Only fires when the duration fields are empty — an
    explicit duration is never overwritten.
    """
    if dur_lo is not None or dur_hi is not None:
        return reps_lo, reps_hi, dur_lo, dur_hi
    if reps_lo is None and reps_hi is None:
        return reps_lo, reps_hi, dur_lo, dur_hi
    if infer_tracking_type(name) != TIME:
        return reps_lo, reps_hi, dur_lo, dur_hi
    return None, None, reps_lo, reps_hi


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
            reps_lo, reps_hi, duration_lo, duration_hi = _repair_timed_targets(
                exercise_name, reps_lo, reps_hi, duration_lo, duration_hi
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


async def exercise_qa(db: Session, user: User, exercise_id: int, question: str) -> dict:
    """Answer a question about one movement, grounded in its catalog entry.

    Retrieval is trivial here and that's the point: there is exactly one
    relevant document — the exercise the athlete is looking at — so "RAG" is a
    primary-key lookup rather than a vector store. The model is told to answer
    from that entry and to say when it doesn't cover the question, which is the
    difference between a grounded answer and a confident guess.
    """
    exercise = db.get(Exercise, exercise_id)
    if exercise is None or (exercise.owner_id is not None and exercise.owner_id != user.id):
        raise AIError("That exercise isn't in your library.")

    provider, _units = _resolve(db, user)
    profile = profile_summary(get_or_create_profile(db, user.id))

    t0 = time.monotonic()
    completion = await provider.complete_text(
        system=prompts.exercise_qa_system_prompt(),
        messages=[
            Message(
                role="user",
                content=prompts.exercise_qa_user_prompt(
                    {
                        "name": exercise.name,
                        "equipment": exercise.equipment,
                        "level": exercise.level,
                        "primary_muscles": exercise.primary_muscles,
                        "secondary_muscles": exercise.secondary_muscles,
                        "instructions": exercise.instructions,
                    },
                    question,
                    profile,
                ),
            )
        ],
    )
    return {
        "answer": completion.text.strip(),
        "exercise_id": exercise_id,
        "exercise_name": exercise.name,
        # Whether the catalog had anything to ground the answer in — the client
        # says so, because an answer from an empty entry is worth less trust.
        "grounded": bool(exercise.instructions),
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": int((time.monotonic() - t0) * 1000),
    }


async def generate_program(
    db: Session,
    user: User,
    *,
    goal: str = "",
    days_per_week: int = 3,
    experience: str = "",
    equipment: str = "",
) -> dict:
    """Write a program from a description of who it's for.

    Deliberately the same output shape as an imported one, run through the same
    `_build_workout_result`: the exercises are matched against the catalog, the
    ranges are normalised, and timed movements are repaired. A generated
    program that names a lift the catalog doesn't have is then visibly
    unmatched rather than silently wrong, exactly like a pasted one.

    Nothing is saved here. The client reviews the proposal and saves it through
    the ordinary split/workout endpoints — same rule as every other AI write.
    """
    provider, units = _resolve(db, user)
    profile = profile_summary(get_or_create_profile(db, user.id))

    t0 = time.monotonic()
    data = await provider.complete_json(
        system=prompts.generate_program_system_prompt(units),
        user=prompts.generate_program_user_prompt(
            goal=goal,
            days_per_week=max(1, min(days_per_week, 7)),
            experience=experience,
            equipment=equipment,
            profile=profile,
        ),
        schema=PROGRAM_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    return _build_workout_result(
        db, user.id, provider, units, latency_ms, _patch_program_schedule(data)
    )


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


async def parse_nutrition(db: Session, user: User, text: str) -> dict:
    """Turn a sentence about food into structured calorie/protein entries.

    Persists nothing — the client reviews the entries and posts them.
    """
    provider, _units = _resolve(db, user)
    t0 = time.monotonic()
    data = await provider.complete_json(
        system=prompts.nutrition_system_prompt(),
        user=prompts.nutrition_user_prompt(text),
        schema=NUTRITION_SCHEMA,
    )
    latency_ms = int((time.monotonic() - t0) * 1000)
    try:
        parsed = ParsedNutrition.model_validate(data)
    except Exception as exc:  # noqa: BLE001
        raise AIError(f"Model output did not match the expected shape: {exc}") from exc
    return {
        "provider": provider.name,
        "model": provider.model,
        "latency_ms": latency_ms,
        "items": [i.model_dump() for i in parsed.items],
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
    """Fetch the athlete profile, creating it on first ask.

    Read-then-create races itself: the app requests /api/profile more than once
    on load, and on the first load after registering both requests found no row
    and both inserted, so the loser 500'd on the unique index. Losing that race
    is a normal outcome, not an error — the winner's row is exactly what the
    loser wanted.
    """
    p = db.scalar(select(AthleteProfile).where(AthleteProfile.user_id == user_id))
    if p is not None:
        return p
    p = AthleteProfile(user_id=user_id)
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        p = db.scalar(select(AthleteProfile).where(AthleteProfile.user_id == user_id))
        if p is None:
            raise  # the constraint that failed wasn't the one we're recovering from
        return p
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
    "check_model",
    "parse_sets",
    "parse_workout",
    "edit_workout_stream",
    "edit_split_stream",
    "parse_nutrition",
    "match_exercise",
    "get_or_create_profile",
    "profile_dict",
    "profile_summary",
    "check_in",
    "coach",
    "coach_history",
    "AIError",
]
