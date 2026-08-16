"""Logging from a phrase goes through the parser, not the model's imagination.

Measured 2026-08-14 against both local models: "log 3x5 squats at 100kg" was
sent as `exercise_id: 1` — "Step Jack", the first row of the catalog — because
the model hand-builds the payload and never searches for the exercise. One
model also collapsed 3x5 into a single set and invented a 2023 date.

The app already has the pipeline that gets this right: `parse_sets` expands NxM
and resolves names through `_match`, which has its own test suite. This turns
the parsed result into a log payload, so the model's only job is recognising
that a phrase is a log request.
"""
from __future__ import annotations

import pytest

from app.ai.service import UnmatchedExercises, session_log_from_items


def _item(name, exercise_id, sets, matched=None):
    return {
        "exercise_name": name,
        "exercise_id": exercise_id,
        "matched_name": matched or name,
        "match": "exact" if exercise_id else "none",
        "sets": sets,
        "notes": None,
    }


def _set(reps=5, weight=100.0, set_type="working"):
    return {"reps": reps, "weight": weight, "rpe": None, "set_type": set_type}


def test_every_parsed_set_survives_into_the_payload() -> None:
    """3x5 arrives as three sets and must stay three."""
    log = session_log_from_items([_item("Squat", 7, [_set(), _set(), _set()])])

    assert len(log.exercises) == 1
    assert [s.reps for s in log.exercises[0].sets] == [5, 5, 5]
    assert [s.weight for s in log.exercises[0].sets] == [100.0, 100.0, 100.0]


def test_the_matched_catalog_id_is_used() -> None:
    log = session_log_from_items([_item("Squat", 7, [_set()])])
    assert log.exercises[0].exercise_id == 7


def test_an_unmatched_exercise_stops_the_whole_log() -> None:
    """Better to log nothing and say so than to log the wrong movement. A
    partial log is silently wrong training data."""
    with pytest.raises(UnmatchedExercises) as excinfo:
        session_log_from_items(
            [_item("Squat", 7, [_set()]), _item("Zercher Widget", None, [_set()])]
        )

    assert excinfo.value.names == ["Zercher Widget"]


def test_no_date_is_invented() -> None:
    """The model hallucinated 2023-10-05. Omitted means the server stamps now."""
    assert session_log_from_items([_item("Squat", 7, [_set()])]).started_at is None


def test_a_supplied_date_is_kept() -> None:
    log = session_log_from_items([_item("Squat", 7, [_set()])], started_at="2026-08-01T17:00:00")
    assert log.started_at is not None and log.started_at.year == 2026


def test_set_type_carries_through() -> None:
    log = session_log_from_items([_item("Squat", 7, [_set(set_type="warmup"), _set()])])
    assert [s.set_type for s in log.exercises[0].sets] == ["warmup", "working"]


def test_an_exercise_with_no_sets_is_dropped() -> None:
    """A named movement with nothing logged against it is noise, not a set."""
    log = session_log_from_items([_item("Squat", 7, [_set()]), _item("Bench", 9, [])])
    assert [e.exercise_id for e in log.exercises] == [7]


def test_nothing_loggable_is_an_error_not_an_empty_session() -> None:
    with pytest.raises(UnmatchedExercises):
        session_log_from_items([_item("Zercher Widget", None, [_set()])])


def test_spotter_sees_log_text_but_not_raw_log_payload_tool(client) -> None:
    """The structural fix is the tool surface: the model gets the safe text
    logger, not the old endpoint where it could invent exercise ids."""
    tools = client.get("/api/companion/manifest").json()["tools"]
    by_path = {(t["method"], t["path"]) for t in tools}

    assert ("POST", "/api/sessions/log-text") in by_path
    assert ("POST", "/api/sessions/log") not in by_path
