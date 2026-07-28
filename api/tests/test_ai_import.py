"""Deterministic cleanup applied after an AI workout-plan parse."""

from app.ai.service import _match, _norm, _normalize_number_range, _primary_exercise


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
