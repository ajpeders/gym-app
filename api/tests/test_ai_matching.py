"""Matcher fidelity against real free-exercise-db catalog names.

The catalog names below are verbatim entries from the seeded dataset — the
matcher must land imported plan names on the right one (or none, so the
review UI offers a custom), never on a semantically wrong variant.
"""
from __future__ import annotations

import pytest

from app.ai.service import _match, _norm, _primary_exercise

# Verbatim names from the free-exercise-db seed, id order preserved-ish (the
# matcher's tie-break prefers lower ids, so keep plausible decoys early).
_CATALOG_NAMES = [
    "Arnold Dumbbell Press",
    "Barbell Bench Press",
    "Barbell Deadlift",
    "Barbell Squat",
    "Bench Dips",
    "Ball Leg Curl",
    "Band Assisted Pull-Up",
    "Cable Crossover",
    "Cable Crunch",
    "Cable Rear Delt Fly",
    "Chin-Up",
    "Close-Grip Front Lat Pulldown",
    "Dumbbell Bench Press",
    "Dumbbell Bicep Curl",
    "Dumbbell Flyes",
    "Dumbbell Lying Rear Lateral Raise",
    "Dumbbell Shoulder Press",
    "Face Pull",
    "Flat Bench Cable Flyes",
    "Hanging Leg Raise",
    "Incline Dumbbell Press",
    "Lateral Raise - With Bands",
    "Lying Leg Curls",
    "One Arm Lat Pulldown",
    "Pullups",
    "Seated Leg Curl",
    "Side Lateral Raise",
    "Split Squats",
    "Weighted Pull Ups",
    "Wide-Grip Lat Pulldown",
]

CATALOG = [(i + 1, n, frozenset(_norm(n))) for i, n in enumerate(_CATALOG_NAMES)]


def resolve(name: str) -> str | None:
    _ex_id, _kind, matched_name = _match(name, CATALOG)
    return matched_name


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        # 'Flyes' spelling must unify with 'fly' so chest fly work matches.
        ("Dumbbell Flys", "Dumbbell Flyes"),
        # Hyphenated 'Pull-Ups' vs the catalog's fused 'Pullups'.
        ("Pull-Ups", "Pullups"),
        ("Chin-Ups", "Chin-Up"),
        # Common gym names should land on the canonical catalog variant,
        # not a decoy sharing tokens (Arnold press, banded raise, one-arm...).
        ("Flat Dumbbell Press", "Dumbbell Bench Press"),
        ("Cable Fly", "Cable Crossover"),
        ("Lateral Raises", "Side Lateral Raise"),
        ("Dumbbell Lateral Raises", "Side Lateral Raise"),
        ("Lat Pulldown", "Wide-Grip Lat Pulldown"),
        ("Leg Curl Machine", "Seated Leg Curl"),
    ],
)
def test_common_names_resolve_to_canonical_entry(query, expected):
    assert resolve(query) == expected


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        # 'A / B' alternatives: _primary_exercise keeps A as the loggable
        # exercise (B moves to notes); A must then match its catalog entry.
        ("Pull-Ups / Assisted Pull-Ups", "Pullups"),
        ("Chin-Ups / Lat Pulldown", "Chin-Up"),
        ("Hanging Knee Raises / Cable Crunches", "Hanging Leg Raise"),
        ("Face Pulls / Rear-Delt Fly", "Face Pull"),
        ("Dumbbell Curls / Incline Curls", "Dumbbell Bicep Curl"),
        ("Bulgarian Split Squats / Walking Lunges", "Split Squats"),
    ],
)
def test_slash_alternatives_match_first_option(query, expected):
    primary, notes = _primary_exercise(query, None)
    assert "/" not in primary
    assert notes and "Alternative:" in notes
    assert resolve(primary) == expected


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        # Terse gym shorthand. Plain token overlap prefers the catalog name
        # closest in length, which sends "bench" to "Bench Dips" — a triceps
        # movement, not what anyone typing "bench" means.
        ("bench", "Barbell Bench Press"),
        ("squat", "Barbell Squat"),
        ("deadlift", "Barbell Deadlift"),
    ],
)
def test_terse_shorthand_resolves_to_the_obvious_lift(query, expected):
    assert resolve(query) == expected


def test_dips_still_reachable_by_name():
    """The synonym must not make the decoy unreachable when actually asked for."""
    assert resolve("Bench Dips") == "Bench Dips"


def test_unknown_name_stays_unmatched():
    ex_id, kind, matched_name = _match("Dead Hang", CATALOG)
    assert ex_id is None and kind == "none" and matched_name is None
