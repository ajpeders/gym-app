"""Gym-floor arithmetic: what to load, what to warm up with, what you can lift.

Standing at a barbell working out plates in your head is the single most common
bit of mental maths in a session, and getting it wrong wastes a set. All three
are pure functions — the app should never need a model, or a network, to answer
"what goes on each side".
"""
from __future__ import annotations

import pytest

from app.calculators import one_rep_max, plate_breakdown, warmup_sets

KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25]


def test_plates_are_per_side_because_that_is_what_you_load() -> None:
    result = plate_breakdown(100, bar=20, plates=KG_PLATES)
    # 40kg a side, however the greedy loader spells it — what matters is that
    # the sum is right and it isn't asking for a fistful of small plates.
    assert sum(result["per_side"]) == 40
    assert len(result["per_side"]) <= 3
    assert result["achievable"] == 100


def test_the_heaviest_plates_go_on_first() -> None:
    """Not just correct — it's the order you actually load them in."""
    assert plate_breakdown(142.5, bar=20, plates=KG_PLATES)["per_side"] == [25, 25, 10, 1.25]


def test_a_weight_the_plates_cannot_make_reports_the_nearest_it_can() -> None:
    result = plate_breakdown(101, bar=20, plates=KG_PLATES)
    assert result["achievable"] == 100
    assert result["leftover"] == pytest.approx(1.0)


def test_the_bar_alone_needs_no_plates() -> None:
    result = plate_breakdown(20, bar=20, plates=KG_PLATES)
    assert result["per_side"] == []
    assert result["achievable"] == 20


def test_less_than_the_bar_is_not_loadable() -> None:
    result = plate_breakdown(15, bar=20, plates=KG_PLATES)
    assert result["per_side"] == []
    assert result["achievable"] == 20
    assert result["below_bar"] is True


def test_pounds_work_the_same_way() -> None:
    result = plate_breakdown(225, bar=45, plates=[45, 35, 25, 10, 5, 2.5])
    assert result["per_side"] == [45, 45]
    assert result["achievable"] == 225


# --- warmups ---------------------------------------------------------------

def test_a_warmup_ramp_starts_at_the_bar_and_ends_below_the_work_set() -> None:
    sets = warmup_sets(100, bar=20)
    assert sets[0]["weight"] == 20
    assert all(s["weight"] < 100 for s in sets)
    assert [s["weight"] for s in sets] == sorted(s["weight"] for s in sets)


def test_warmup_reps_come_down_as_the_weight_goes_up() -> None:
    reps = [s["reps"] for s in warmup_sets(100, bar=20)]
    assert reps == sorted(reps, reverse=True)


def test_warmups_land_on_loadable_weights() -> None:
    """A warmup you can't load is a warmup you'll skip."""
    for s in warmup_sets(100, bar=20, plates=KG_PLATES):
        assert plate_breakdown(s["weight"], bar=20, plates=KG_PLATES)["leftover"] == 0


def test_a_working_weight_at_or_below_the_bar_needs_no_ramp() -> None:
    assert warmup_sets(20, bar=20) == []


def test_a_light_working_weight_gets_a_short_ramp() -> None:
    """Three ramp sets to reach 40kg is a warmup longer than the workout."""
    assert len(warmup_sets(40, bar=20)) <= 2


# --- one-rep max -----------------------------------------------------------

def test_one_rep_max_agrees_with_the_analysis_module() -> None:
    from app.analysis import e1rm

    assert one_rep_max(100, 5)["estimate"] == e1rm(100, 5)


def test_the_percentage_table_is_what_people_actually_want() -> None:
    table = one_rep_max(100, 1)["percentages"]
    assert table["90%"] == 90.0
    assert table["70%"] == 70.0


def test_a_single_is_its_own_max() -> None:
    assert one_rep_max(120, 1)["estimate"] == 120


def test_nothing_sensible_from_nothing() -> None:
    assert one_rep_max(None, 5) is None
    assert one_rep_max(100, 0) is None
