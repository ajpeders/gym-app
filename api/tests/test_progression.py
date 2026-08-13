"""The plan's own progression rule, made visible.

Every plan in this app carries the same instruction — "when you hit the top of
the rep range for all sets, increase weight next time" — and the app has both
halves of it (the snapshotted target, the logged reps) but has never said
anything. This is the rule as a pure function so the API can flag it.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.progression import cleared_rep_range


def _set(reps: int | None, set_type: str = "working", completed: bool = True):
    return SimpleNamespace(reps=reps, set_type=set_type, completed=completed)


def test_all_sets_at_the_top_of_the_range_clears_it() -> None:
    assert cleared_rep_range(3, 12, [_set(12), _set(12), _set(12)]) is True


def test_going_past_the_top_of_the_range_also_clears_it() -> None:
    assert cleared_rep_range(3, 12, [_set(13), _set(12), _set(15)]) is True


def test_one_short_set_is_not_cleared() -> None:
    """'for ALL sets' is the whole rule — 12/12/11 means keep the weight."""
    assert cleared_rep_range(3, 12, [_set(12), _set(12), _set(11)]) is False


def test_the_planned_number_of_sets_must_actually_be_done() -> None:
    """Two great sets out of three is an unfinished exercise, not a PR."""
    assert cleared_rep_range(3, 12, [_set(12), _set(12)]) is False


def test_extra_sets_beyond_the_plan_are_fine() -> None:
    assert cleared_rep_range(3, 12, [_set(12)] * 4) is True


def test_warmups_and_drop_sets_do_not_count_against_you() -> None:
    sets = [_set(5, "warmup"), _set(12), _set(12), _set(12), _set(20, "drop")]
    assert cleared_rep_range(3, 12, sets) is True


def test_a_failure_set_does_not_block_the_nudge() -> None:
    sets = [_set(12), _set(12), _set(12), _set(3, "failure")]
    assert cleared_rep_range(3, 12, sets) is True


def test_the_log_apis_normal_set_type_counts_as_a_working_set() -> None:
    """/sessions/log writes 'normal'; the live screen writes 'working'."""
    assert cleared_rep_range(2, 10, [_set(10, "normal"), _set(10, "normal")]) is True


def test_an_exercise_with_no_rep_range_is_never_flagged() -> None:
    assert cleared_rep_range(3, None, [_set(50), _set(50), _set(50)]) is False


def test_an_exercise_with_no_sets_is_never_flagged() -> None:
    assert cleared_rep_range(3, 12, []) is False


def test_an_uncompleted_set_does_not_count() -> None:
    sets = [_set(12), _set(12), _set(12, completed=False)]
    assert cleared_rep_range(3, 12, sets) is False


def test_a_set_with_no_reps_logged_does_not_count() -> None:
    """Timed work lands here — seconds live in duration, not reps."""
    assert cleared_rep_range(3, 12, [_set(12), _set(12), _set(None)]) is False


def test_without_a_planned_set_count_any_full_effort_counts() -> None:
    """Ad-hoc exercises added mid-session have no target_sets snapshot."""
    assert cleared_rep_range(None, 12, [_set(12), _set(12)]) is True


# --- exposed on the API -----------------------------------------------------


def _plan_session(client, headers, *, target_sets=3, target_reps=8, target_reps_max=12):
    """A session started from a plan day, so the targets are snapshotted onto it."""
    ex_id = client.get("/api/exercises", headers=headers).json()["items"][0]["id"]
    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Push",
            "exercises": [
                {
                    "exercise_id": ex_id,
                    "order": 0,
                    "target_sets": target_sets,
                    "target_reps": target_reps,
                    "target_reps_max": target_reps_max,
                }
            ],
        },
    ).json()
    session = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": workout["id"]}
    ).json()
    return session["id"], session["exercises"][0]["id"]


def _log(client, headers, sid, se_id, reps, weight=60.0):
    return client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers,
        json={"reps": reps, "weight": weight},
    )


def _flag(client, headers, sid):
    return client.get(f"/api/sessions/{sid}", headers=headers).json()["exercises"][0][
        "cleared_rep_range"
    ]


def test_the_session_reports_when_the_range_was_cleared(client, auth):
    headers, _, _ = auth
    sid, se_id = _plan_session(client, headers)
    for _ in range(3):
        _log(client, headers, sid, se_id, 12)

    assert _flag(client, headers, sid) is True


def test_the_flag_stays_false_until_the_last_set_lands(client, auth):
    """It has to appear the moment you finish, mid-workout — that is the point."""
    headers, _, _ = auth
    sid, se_id = _plan_session(client, headers)
    _log(client, headers, sid, se_id, 12)
    assert _flag(client, headers, sid) is False
    _log(client, headers, sid, se_id, 12)
    assert _flag(client, headers, sid) is False
    _log(client, headers, sid, se_id, 12)
    assert _flag(client, headers, sid) is True


def test_falling_short_on_one_set_reports_false(client, auth):
    headers, _, _ = auth
    sid, se_id = _plan_session(client, headers)
    for reps in (12, 12, 11):
        _log(client, headers, sid, se_id, reps)

    assert _flag(client, headers, sid) is False


def test_an_exercise_with_no_planned_range_reports_false(client, auth):
    headers, _, _ = auth
    sid, se_id = _plan_session(client, headers, target_reps_max=None)
    for _ in range(3):
        _log(client, headers, sid, se_id, 20)

    assert _flag(client, headers, sid) is False
