"""Training analysis: what the sets already say, worked out deterministically.

Everything here is arithmetic over logged sets and the catalog's muscle tags —
no model involved. That's the point: an AI can *interpret* "your rear delts are
undertrained", but it must not be the thing that decides whether they are.

The vocabulary, once:

* a **hard set** is a working set. Warmups and drop sets don't count toward
  weekly volume, which is the standard way this is counted.
* a primary muscle gets **full credit**, a secondary muscle **half** — a bench
  press trains triceps, but not the way a triceps extension does.
* **MEV/MAV/MRV** are the usual weekly landmarks (minimum effective, maximum
  adaptive, maximum recoverable) in hard sets per muscle per week.
"""
from __future__ import annotations

import pytest

from app.analysis import (
    balance_ratios,
    coverage,
    e1rm,
    hard_sets_by_muscle,
    tonnage,
    trend_direction,
)


def _set(reps=8, weight=100.0, set_type="working"):
    return {"reps": reps, "weight": weight, "set_type": set_type}


def _entry(primary, secondary=(), sets=None):
    return {"primary": list(primary), "secondary": list(secondary), "sets": sets or [_set()]}


# --- weekly volume per muscle ----------------------------------------------

def test_a_working_set_is_one_hard_set_for_its_primary_muscle() -> None:
    assert hard_sets_by_muscle([_entry(["chest"])]) == {"chest": 1.0}


def test_a_secondary_muscle_gets_half_credit() -> None:
    """Bench trains triceps, but not the way an extension does."""
    volume = hard_sets_by_muscle([_entry(["chest"], ["triceps"])])
    assert volume == {"chest": 1.0, "triceps": 0.5}


def test_warmups_and_drops_are_not_hard_sets() -> None:
    sets = [_set(set_type="warmup"), _set(), _set(set_type="drop")]
    assert hard_sets_by_muscle([_entry(["back"], sets=sets)]) == {"back": 1.0}


def test_volume_accumulates_across_exercises() -> None:
    entries = [
        _entry(["chest"], ["triceps"], [_set(), _set(), _set()]),
        _entry(["triceps"], sets=[_set(), _set()]),
    ]
    assert hard_sets_by_muscle(entries) == {"chest": 3.0, "triceps": 3.5}


def test_an_exercise_with_no_muscle_tags_is_counted_nowhere_but_does_not_crash() -> None:
    """338 catalog rows are missing images; some are missing tags too."""
    assert hard_sets_by_muscle([_entry([])]) == {}


# --- coverage against the landmarks ----------------------------------------

def test_a_muscle_below_the_minimum_is_a_gap() -> None:
    rows = coverage({"chest": 2.0}, weeks=1)
    chest = next(r for r in rows if r["muscle"] == "chest")
    assert chest["status"] == "under"
    assert chest["weekly_sets"] == 2.0


def test_a_muscle_in_the_productive_range_reads_as_such() -> None:
    rows = coverage({"chest": 14.0}, weeks=1)
    assert next(r for r in rows if r["muscle"] == "chest")["status"] == "productive"


def test_too_much_volume_is_flagged_too() -> None:
    """Past the recoverable ceiling is a problem, not an achievement."""
    rows = coverage({"chest": 40.0}, weeks=1)
    assert next(r for r in rows if r["muscle"] == "chest")["status"] == "over"


def test_a_muscle_never_trained_is_reported_as_missing_not_omitted() -> None:
    """An absent muscle is the most important thing on the screen; leaving it
    out of the list is how it goes unnoticed."""
    rows = coverage({"chest": 12.0}, weeks=1)
    biceps = next(r for r in rows if r["muscle"] == "biceps")
    assert biceps["weekly_sets"] == 0.0
    assert biceps["status"] == "missing"


def test_volume_is_averaged_over_the_window() -> None:
    """28 sets across 4 weeks is 7 a week, not 28."""
    rows = coverage({"chest": 28.0}, weeks=4)
    assert next(r for r in rows if r["muscle"] == "chest")["weekly_sets"] == 7.0


# --- balance ---------------------------------------------------------------

def test_push_pull_and_quad_ham_ratios() -> None:
    ratios = balance_ratios({"chest": 10, "shoulders": 2, "back": 6, "quadriceps": 9, "hamstrings": 3})
    push_pull = next(r for r in ratios if r["name"] == "push:pull")
    assert push_pull["ratio"] == pytest.approx(2.0)  # 12 push vs 6 pull
    assert push_pull["balanced"] is False

    quad_ham = next(r for r in ratios if r["name"] == "quad:ham")
    assert quad_ham["ratio"] == pytest.approx(3.0)
    assert quad_ham["balanced"] is False


def test_a_ratio_with_nothing_on_one_side_is_reported_not_divided_by_zero() -> None:
    ratios = balance_ratios({"chest": 10})
    push_pull = next(r for r in ratios if r["name"] == "push:pull")
    assert push_pull["ratio"] is None
    assert push_pull["balanced"] is False


def test_an_even_split_is_balanced() -> None:
    ratios = balance_ratios({"chest": 6, "back": 6, "quadriceps": 6, "hamstrings": 6})
    assert all(r["balanced"] for r in ratios)


# --- per-exercise strength -------------------------------------------------

def test_estimated_one_rep_max_uses_epley() -> None:
    assert e1rm(100, 1) == pytest.approx(100)
    assert e1rm(100, 5) == pytest.approx(116.67, abs=0.01)


def test_a_bodyweight_or_timed_set_has_no_estimated_max() -> None:
    assert e1rm(None, 5) is None
    assert e1rm(100, None) is None
    assert e1rm(100, 0) is None


def test_tonnage_is_load_times_reps_over_the_working_sets() -> None:
    sets = [_set(reps=5, weight=100), _set(reps=5, weight=100, set_type="warmup")]
    assert tonnage(sets) == 500


def test_trend_needs_two_points_before_it_says_anything() -> None:
    assert trend_direction([100.0]) == "flat"
    assert trend_direction([]) == "flat"


def test_trend_reads_the_direction_of_travel() -> None:
    assert trend_direction([100.0, 102.5, 105.0]) == "up"
    assert trend_direction([105.0, 102.5, 100.0]) == "down"
    # Noise around a level is not a trend — this is what makes a plateau
    # distinguishable from progress.
    assert trend_direction([100.0, 101.0, 100.0, 100.5]) == "flat"
