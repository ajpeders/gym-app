"""Deterministic cleanup applied after an AI workout-plan parse."""

from app.ai.service import (
    _match,
    _norm,
    _normalize_number_range,
    _primary_exercise,
    _repair_timed_targets,
)


def test_slash_alternative_becomes_note() -> None:
    name, notes = _primary_exercise(
        "Pull-Ups / Assisted Pull-Ups", "Start each rep from nearly straight arms."
    )

    assert name == "Pull-Ups"
    assert notes == (
        "Alternative: Assisted Pull-Ups\n"
        "Start each rep from nearly straight arms."
    )


def test_ranges_are_ordered_and_degenerate_max_is_removed() -> None:
    assert _normalize_number_range(25, 20) == (20, 25)
    assert _normalize_number_range(None, 60) == (60, None)
    assert _normalize_number_range(20, 20) == (20, None)


def test_match_returns_canonical_catalog_name() -> None:
    catalog = [(7, "Dumbbell Bench Press", frozenset(_norm("Dumbbell Bench Press")))]

    exercise_id, quality, canonical_name = _match("Dumbbell Chest Press", catalog)

    assert exercise_id == 7
    assert quality == "exact"
    assert canonical_name == "Dumbbell Bench Press"


def test_a_held_movements_seconds_are_rescued_from_the_rep_fields() -> None:
    """"Dead Hang | 2 | 20-60 seconds" comes back as reps 20-60 from qwen3:8b
    even though the prompt spells the rule out — the model reads the column, not
    the unit. We already know a dead hang is timed, so fix it rather than nag."""
    assert _repair_timed_targets("Dead Hang", 20, 60, None, None) == (None, None, 20, 60)


def test_a_rep_counted_movement_keeps_its_reps() -> None:
    assert _repair_timed_targets("Leg Press", 8, 12, None, None) == (8, 12, None, None)


def test_a_timed_movement_the_model_got_right_is_left_alone() -> None:
    assert _repair_timed_targets("Plank", None, None, 30, 60) == (None, None, 30, 60)


def test_reps_win_when_a_timed_movement_somehow_has_both() -> None:
    """Never silently drop a duration the model was explicit about."""
    assert _repair_timed_targets("Dead Hang", 20, 60, 30, None) == (20, 60, 30, None)
