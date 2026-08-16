"""Achievements: the things you already did, said out loud.

Every one is derived from logged sets — nothing is stored, nothing is granted,
and none of it can be earned by anything other than training. That rules out
the usual gamification failure mode where the badge is the point; these only
ever describe what the log already says.

Deliberately few. A wall of 60 badges is noise, and the ones that matter to a
lifter are: showing up, keeping it up, and lifting more than before.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _exercise(client, headers, name="E2E Lift"):
    return client.post(
        "/api/exercises",
        headers=headers,
        json={
            "name": name,
            "category": "strength",
            "equipment": "barbell",
            "primary_muscles": ["chest"],
            "instructions": [],
        },
    ).json()


def _log(client, headers, exercise_id, sets, days_ago=0):
    when = (datetime.now(timezone.utc) - timedelta(days=days_ago)).replace(hour=12)
    r = client.post(
        "/api/sessions/log",
        headers=headers,
        json={
            "name": "Session",
            "started_at": when.isoformat(),
            "exercises": [{"exercise_id": exercise_id, "sets": sets}],
        },
    )
    assert r.status_code == 201, r.text


def _set(reps=5, weight=100.0):
    return {"reps": reps, "weight": weight, "set_type": "working"}


def _earned(client, headers):
    r = client.get("/api/stats/achievements", headers=headers)
    assert r.status_code == 200, r.text
    return {a["slug"]: a for a in r.json() if a["earned"]}


def test_a_new_account_has_earned_nothing_but_is_told_what_there_is(client, auth):
    """An empty wall of badges is discouraging; an empty *progress* list isn't."""
    headers, _, _ = auth
    everything = client.get("/api/stats/achievements", headers=headers).json()
    assert everything, "the list should always describe what's available"
    assert all(a["earned"] is False for a in everything)
    assert all(a["progress"] == 0 for a in everything)


def test_the_first_session_is_worth_saying(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers)
    _log(client, headers, ex["id"], [_set()])
    assert "first-session" in _earned(client, headers)


def test_session_milestones_accumulate(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers)
    for day in range(10):
        _log(client, headers, ex["id"], [_set()], days_ago=day)

    earned = _earned(client, headers)
    assert "sessions-10" in earned
    assert "sessions-50" not in earned


def test_progress_is_reported_for_what_is_not_earned_yet(client, auth):
    """"7 of 10" is motivating in a way a locked padlock isn't."""
    headers, _, _ = auth
    ex = _exercise(client, headers)
    for day in range(7):
        _log(client, headers, ex["id"], [_set()], days_ago=day)

    rows = {a["slug"]: a for a in client.get("/api/stats/achievements", headers=headers).json()}
    assert rows["sessions-10"]["earned"] is False
    assert rows["sessions-10"]["progress"] == 7
    assert rows["sessions-10"]["target"] == 10


def test_a_streak_of_consecutive_days_is_recognised(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers)
    for day in range(3):
        _log(client, headers, ex["id"], [_set()], days_ago=day)
    assert "streak-3" in _earned(client, headers)


def test_a_broken_streak_does_not_count(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers)
    for day in (0, 1, 5, 6):
        _log(client, headers, ex["id"], [_set()], days_ago=day)
    assert "streak-3" not in _earned(client, headers)


def test_tonnage_milestones_come_from_the_sets(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers)
    # 10 sets of 5 x 100kg = 5,000kg.
    _log(client, headers, ex["id"], [_set() for _ in range(10)])
    earned = _earned(client, headers)
    assert "tonnage-5k" in earned
    assert "tonnage-100k" not in earned


def test_a_personal_record_is_its_own_achievement(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers)
    _log(client, headers, ex["id"], [_set(weight=100)], days_ago=7)
    _log(client, headers, ex["id"], [_set(weight=110)], days_ago=1)

    earned = _earned(client, headers)
    assert "first-pr" in earned


def test_one_persons_training_never_counts_toward_anothers(client, auth, auth2):
    headers, _, _ = auth
    other_headers, _, _ = auth2
    theirs = _exercise(client, other_headers, "Their Lift")
    for day in range(12):
        _log(client, other_headers, theirs["id"], [_set()], days_ago=day)

    assert _earned(client, headers) == {}
