"""Infer how a movement should be logged: load x reps, reps only, or time.

The catalogs (wger / free-exercise-db) don't carry this, so it's derived from
equipment + name. Conservative by design: anything unrecognised stays
``weight_reps``, which is the safe default because weight is optional anyway.
"""
from __future__ import annotations

import re

WEIGHT_REPS = "weight_reps"
BODYWEIGHT = "bodyweight"
TIME = "time"

# Held / timed efforts — measured in seconds, not reps.
_TIME_PATTERNS = [
    r"\bplank",
    r"\bdead[-\s]?hang",
    r"\bhang\b",
    r"\bhold\b",
    r"\bisometric",
    r"\bwall\s*sit",
    r"\bl-?sit",
    r"\bside\s*bridge",
    r"\bsuperman\s*hold",
]

# Equipment values both catalogs use for "just you".
_BODYWEIGHT_EQUIPMENT = {
    "none (bodyweight exercise)",
    "body only",
    "bodyweight",
    "none",
}

# Movements that are bodyweight even when the catalog's equipment says
# otherwise (a pull-up bar / dip station is listed as equipment).
_BODYWEIGHT_PATTERNS = [
    r"\bpull[-\s]?ups?\b",
    r"\bchin[-\s]?ups?\b",
    r"\bpush[-\s]?ups?\b",
    r"\bpress[-\s]?ups?\b",
    r"\bdips?\b",
    r"\bsit[-\s]?ups?\b",
    r"\bcrunch",
    r"\bknee\s*raises?\b",
    r"\bleg\s*raises?\b",
    r"\bburpees?\b",
    r"\bmountain\s*climbers?\b",
    r"\bmuscle[-\s]?ups?\b",
]

_time_re = re.compile("|".join(_TIME_PATTERNS), re.I)
_bw_re = re.compile("|".join(_BODYWEIGHT_PATTERNS), re.I)


def infer_tracking_type(name: str, equipment: str | None = None) -> str:
    """Best-guess tracking type for an exercise."""
    n = name or ""
    if _time_re.search(n):
        return TIME
    eq = (equipment or "").strip().lower()
    if eq in _BODYWEIGHT_EQUIPMENT or _bw_re.search(n):
        return BODYWEIGHT
    return WEIGHT_REPS
