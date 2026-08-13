"""Matcher fidelity against the *live* wger catalog.

`test_ai_matching.py` pins the algorithm against free-exercise-db names, which
is the catalog we seeded from originally and the one that backfills images. The
catalog actually served is wger (~828 rows), and it spells things differently
and is missing entries free-exercise-db has: there is no plain "Dumbbell Bench
Press" and no plain "Lat Pulldown", only angle/grip variants. Every name below
is verbatim from a seeded wger row, with its real id, because the matcher's
final tie-break prefers the lower id.

Each case here is a wrong match observed in a live re-import of a real plan.
"""
from __future__ import annotations

import pytest

from app.ai.service import _match, _norm

_WGER_NAMES = [
    (33, "Tricep Pushdown on Cable"),
    (44, "Knee Raises"),
    (60, "Chin Up"),
    (62, "Bulgarian split squats left"),
    (63, "Bulgarian split squats right"),
    (95, "Chest Press"),
    (111, "Roman Chair Crunch"),
    (115, "Cable Cross-over"),
    (140, "Dumbbell Bent Over Face Pull"),
    (179, "Wide-grip supinated lat pulldown"),
    (191, "Machine Lateral Raise"),
    (195, "Dumbbell Romanian Deadlift"),
    (213, "One Arm Bent Row"),
    (250, "Leg Extension"),
    (266, "Seated Cable Row"),
    (335, "Lower Back Extensions"),
    (480, "Cable Fly Middle Chest"),
    (530, "Machine Side Lateral Raises"),
    (647, "Dumbbell Curl"),
    (678, "Decline Bench Press Dumbbell"),
    (717, "Hammer Curls"),
    (726, "Lateral Raises"),
    (761, "Row"),
    (770, "Shoulder Press, Dumbbells"),
    (785, "Standing Calf Raises"),
    (792, "Leg Press"),
    (811, "Incline Bench Press - Dumbbell"),
]

CATALOG = [(ex_id, name, frozenset(_norm(name))) for ex_id, name in _WGER_NAMES]


def resolve(name: str) -> str | None:
    _ex_id, _kind, matched_name = _match(name, CATALOG)
    return matched_name


@pytest.mark.parametrize(
    ("query", "wrong"),
    [
        # A crunch is not a back extension — opposite movement, opposite muscle.
        # The fuzzy fallback accepted it on "roman"+"chair" alone.
        ("Roman Chair Back Extensions", "Roman Chair Crunch"),
        # No flat dumbbell bench exists in wger. Landing on Decline (or Incline,
        # which only lost on the id tie-break) is worse than offering a custom.
        ("Flat Dumbbell Press", "Decline Bench Press Dumbbell"),
        ("Flat Dumbbell Press", "Incline Bench Press - Dumbbell"),
    ],
)
def test_contradicted_variants_are_not_matched(query, wrong):
    assert resolve(query) != wrong


def test_a_movement_with_no_honest_match_stays_unmatched():
    ex_id, kind, name = _match("Flat Dumbbell Press", CATALOG)
    assert (ex_id, kind, name) == (None, "none", None)


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        # Asking for dumbbells must not hand back a machine.
        ("Dumbbell Lateral Raises", "Lateral Raises"),
        # Unqualified: prefer the plain entry over one that adds equipment.
        ("Lateral Raises", "Lateral Raises"),
        # A one-token subset match ("Row") used to beat a three-token overlap.
        ("One-Arm Dumbbell Row", "One Arm Bent Row"),
        # wger hyphenates it; the synonym rewrites to one token and missed.
        ("Cable Fly", "Cable Cross-over"),
    ],
)
def test_live_import_names_land_on_the_right_entry(query, expected):
    assert resolve(query) == expected


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("Incline Dumbbell Press", "Incline Bench Press - Dumbbell"),
        ("Seated Dumbbell Shoulder Press", "Shoulder Press, Dumbbells"),
        ("Cable Triceps Pushdown", "Tricep Pushdown on Cable"),
        ("Leg Extension", "Leg Extension"),
        ("Leg Press", "Leg Press"),
        ("Standing Calf Raises", "Standing Calf Raises"),
        ("Seated Cable Row", "Seated Cable Row"),
        ("Hammer Curls", "Hammer Curls"),
        ("Dumbbell Curls", "Dumbbell Curl"),
        ("Dumbbell Romanian Deadlift", "Dumbbell Romanian Deadlift"),
        ("Hanging Knee Raises", "Knee Raises"),
        ("Chin-Ups", "Chin Up"),
    ],
)
def test_already_correct_matches_stay_correct(query, expected):
    assert resolve(query) == expected
