"""Rotation maths for rolling splits — a cycle with no calendar in it.

A rigid split answers "what's today?" from the date. A rolling split can't:
Push/Pull/Legs with rest whenever you need it has no weekdays at all, so
position in the cycle has to come from what was actually logged. These are the
two questions Home asks, kept pure so they're testable without a database:

* which day comes up next, and
* which days are already done in the current pass.

"Current pass" is the streak of distinct workouts most recently logged. Walking
backwards until a workout repeats is what makes the cycle self-resetting: the
moment you come round to a day you've already done, a new pass has begun.
"""
from __future__ import annotations

from app.rotation import done_this_cycle, up_next

PPL = [10, 20, 30]  # Push, Pull, Legs


def test_nothing_logged_starts_at_the_top() -> None:
    assert up_next(PPL, []) == 10
    assert done_this_cycle(PPL, []) == set()


def test_the_next_day_follows_the_last_one_logged() -> None:
    assert up_next(PPL, [10]) == 20
    assert up_next(PPL, [20, 10]) == 30


def test_the_cycle_wraps() -> None:
    assert up_next(PPL, [30, 20, 10]) == 10


def test_a_completed_pass_resets_done() -> None:
    """All three done means a fresh cycle, not a permanently finished one."""
    assert done_this_cycle(PPL, [30, 20, 10]) == set()


def test_a_partial_pass_reports_what_is_done() -> None:
    assert done_this_cycle(PPL, [20, 10]) == {10, 20}


def test_only_the_current_pass_counts() -> None:
    """Last week's Legs is not this cycle's Legs."""
    assert done_this_cycle(PPL, [20, 10, 30, 20, 10]) == {10, 20}


def test_out_of_order_logging_skips_to_the_first_unfinished_day() -> None:
    """Logged Push then Legs: Pull is what's left, not Push again."""
    assert up_next(PPL, [30, 10]) == 20
    assert done_this_cycle(PPL, [30, 10]) == {10, 30}


def test_a_workout_no_longer_in_the_split_is_ignored() -> None:
    """A deleted day still has sessions pointing at it; it can't set position."""
    assert up_next(PPL, [99, 10]) == 20
    assert done_this_cycle(PPL, [99, 10]) == {10}


def test_an_empty_rotation_has_no_next() -> None:
    assert up_next([], [10]) is None
    assert done_this_cycle([], [10]) == set()


def test_repeating_the_same_day_starts_a_new_pass() -> None:
    """Two Pushes in a row: the second one opens a fresh cycle."""
    assert done_this_cycle(PPL, [10, 10, 30, 20]) == {10}
    assert up_next(PPL, [10, 10, 30, 20]) == 20
