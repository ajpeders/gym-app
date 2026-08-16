"""What to put on the bar next time.

The rule is the plan's own: clear the top of the rep range on every working set
and the weight goes up. That is already how `progression.cleared_rep_range`
decides whether to show the nudge — this turns the same judgement into a
concrete target, so the suggestion can never disagree with the badge.

Deliberately dumb and deliberately deterministic. A model guessing "try 82.5"
is exactly the kind of invented number that shouldn't reach training data.
"""
from __future__ import annotations

from app.overload import suggest_next


def _set(reps=8, weight=100.0, set_type="working"):
    return {"reps": reps, "weight": weight, "set_type": set_type}


TARGET = {"target_sets": 3, "target_reps": 6, "target_reps_max": 8}


def test_clearing_the_range_adds_weight() -> None:
    last = [_set(reps=8), _set(reps=8), _set(reps=8)]
    s = suggest_next({**TARGET, "equipment": "barbell"}, last)
    assert s["weight"] == 102.5
    assert s["reps"] == 6  # back to the bottom of the range at the new load
    assert s["action"] == "add_weight"


def test_falling_short_repeats_the_same_weight() -> None:
    last = [_set(reps=8), _set(reps=7), _set(reps=8)]
    s = suggest_next(TARGET, last)
    assert s["action"] == "repeat"
    assert s["weight"] == 100.0
    assert s["reps"] == 8  # aim for the top of the range again


def test_missing_a_planned_set_is_not_clearing_it() -> None:
    """Two sets at the top of the range is not three."""
    s = suggest_next(TARGET, [_set(reps=8), _set(reps=8)])
    assert s["action"] == "repeat"


def test_the_jump_matches_the_equipment() -> None:
    """A dumbbell pair moves in bigger steps than a barbell, and a machine's
    stack is coarser still — suggesting +2.5kg on a plate-loaded stack is
    advice you can't follow."""
    top = [_set(reps=8)] * 3
    assert suggest_next({**TARGET, "equipment": "barbell"}, top)["weight"] == 102.5
    assert suggest_next({**TARGET, "equipment": "dumbbell"}, top)["weight"] == 104.0
    assert suggest_next({**TARGET, "equipment": "machine"}, top)["weight"] == 105.0


def test_a_bodyweight_movement_adds_reps_instead_of_load() -> None:
    last = [{"reps": 12, "weight": None, "set_type": "working"}] * 3
    s = suggest_next({"target_sets": 3, "target_reps": 8, "target_reps_max": 12}, last)
    assert s["action"] == "add_reps"
    assert s["weight"] is None
    assert s["reps"] == 13


def test_a_fixed_rep_target_still_progresses() -> None:
    """No range means the target itself is the top of the range."""
    last = [_set(reps=5)] * 3
    s = suggest_next({"target_sets": 3, "target_reps": 5, "target_reps_max": None}, last)
    assert s["action"] == "add_weight"
    assert s["reps"] == 5


def test_nothing_logged_yet_suggests_the_plan_as_written() -> None:
    s = suggest_next(TARGET, [])
    assert s["action"] == "start"
    assert s["reps"] == 6
    assert s["weight"] is None


def test_warmups_never_count_toward_clearing_the_range() -> None:
    last = [_set(reps=8, set_type="warmup"), _set(reps=8), _set(reps=8), _set(reps=8)]
    assert suggest_next(TARGET, last)["action"] == "add_weight"


def test_the_heaviest_working_set_sets_the_baseline() -> None:
    """Sets logged at different loads: progress from the top one, not the last."""
    last = [_set(reps=8, weight=100), _set(reps=8, weight=102.5), _set(reps=8, weight=100)]
    assert suggest_next({**TARGET, "equipment": "barbell"}, last)["weight"] == 105.0


def test_a_timed_hold_asks_for_more_seconds() -> None:
    last = [{"duration_seconds": 60, "weight": None, "reps": None, "set_type": "working"}] * 3
    s = suggest_next(
        {"target_sets": 3, "target_duration_seconds": 45, "target_duration_seconds_max": 60},
        last,
    )
    assert s["action"] == "add_time"
    assert s["duration_seconds"] == 65
