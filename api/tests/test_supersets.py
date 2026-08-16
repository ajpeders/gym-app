"""Supersets: exercises you alternate between rather than finish in turn.

A1/A2 is not a formatting preference — it changes what the session *is*. You
take one rest for the pair, not one each, and the plan has to say so or the
logging screen can't know.

Modelled as a label on the exercise (`superset_group`) rather than a table of
groups: it's one nullable column, it survives reordering, and "no group" stays
the default that costs nothing.
"""
from __future__ import annotations


def _exercise(client, headers, name):
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


def _workout_with_superset(client, headers):
    a = _exercise(client, headers, "E2E Curl")
    b = _exercise(client, headers, "E2E Pushdown")
    c = _exercise(client, headers, "E2E Squat")
    return client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Arms",
            "weekdays": [0, 1, 2, 3, 4, 5, 6],
            "exercises": [
                {"exercise_id": a["id"], "order": 0, "target_sets": 3, "target_reps": 10,
                 "superset_group": "A"},
                {"exercise_id": b["id"], "order": 1, "target_sets": 3, "target_reps": 10,
                 "superset_group": "A"},
                {"exercise_id": c["id"], "order": 2, "target_sets": 3, "target_reps": 5},
            ],
        },
    ).json()


def test_a_plan_can_pair_two_exercises(client, auth):
    headers, _, _ = auth
    workout = _workout_with_superset(client, headers)
    groups = [e["superset_group"] for e in workout["exercises"]]
    assert groups == ["A", "A", None]


def test_pairing_survives_a_reload(client, auth):
    headers, _, _ = auth
    workout = _workout_with_superset(client, headers)
    fresh = client.get(f"/api/workouts/{workout['id']}", headers=headers).json()
    assert [e["superset_group"] for e in fresh["exercises"]] == ["A", "A", None]


def test_an_exercise_defaults_to_no_group(client, auth):
    """The overwhelmingly common case must stay free."""
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Plain")
    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={"name": "Plain", "exercises": [{"exercise_id": ex["id"], "order": 0}]},
    ).json()
    assert workout["exercises"][0]["superset_group"] is None


def test_starting_a_session_snapshots_the_pairing(client, auth):
    """Like every other target: history keeps what the plan said at the time,
    even if the plan changes afterwards."""
    headers, _, _ = auth
    workout = _workout_with_superset(client, headers)

    session = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": str(workout["id"])}
    ).json()
    assert [e["superset_group"] for e in session["exercises"]] == ["A", "A", None]

    # Change the plan; the running session keeps what it started with.
    client.patch(
        f"/api/workouts/{workout['id']}",
        headers=headers,
        json={
            "exercises": [
                {"exercise_id": e["exercise_id"], "order": i}
                for i, e in enumerate(workout["exercises"])
            ]
        },
    )
    still = client.get(f"/api/sessions/{session['id']}", headers=headers).json()
    assert [e["superset_group"] for e in still["exercises"]] == ["A", "A", None]


def test_a_group_can_be_removed(client, auth):
    headers, _, _ = auth
    workout = _workout_with_superset(client, headers)
    updated = client.patch(
        f"/api/workouts/{workout['id']}",
        headers=headers,
        json={
            "exercises": [
                {"exercise_id": e["exercise_id"], "order": i, "superset_group": None}
                for i, e in enumerate(workout["exercises"])
            ]
        },
    ).json()
    assert all(e["superset_group"] is None for e in updated["exercises"])


def test_a_group_label_is_kept_short(client, auth):
    """A label, not free text — it's shown as a badge on a phone."""
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Long Label")
    r = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Bad",
            "exercises": [
                {"exercise_id": ex["id"], "order": 0, "superset_group": "this is a sentence"}
            ],
        },
    )
    assert r.status_code == 422
