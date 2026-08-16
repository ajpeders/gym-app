"""The analysis endpoints, wired to real rows.

`test_analysis.py` and `test_overload.py` cover the maths. These cover the
plumbing that feeds it: whose sets are counted, which window, and where the
muscle tags come from — the parts that can't be wrong in a pure function but
very much can be wrong in a query.
"""
from datetime import datetime, timedelta, timezone


def _exercise(client, headers, name, primary, secondary=(), equipment="barbell"):
    r = client.post(
        "/api/exercises",
        headers=headers,
        json={
            "name": name,
            "category": "strength",
            "equipment": equipment,
            "primary_muscles": list(primary),
            "secondary_muscles": list(secondary),
            "instructions": [],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _log(client, headers, exercise_id, sets, days_ago=1, name="Session"):
    when = (datetime.now(timezone.utc) - timedelta(days=days_ago)).replace(hour=12)
    r = client.post(
        "/api/sessions/log",
        headers=headers,
        json={
            "name": name,
            "started_at": when.isoformat(),
            "exercises": [{"exercise_id": exercise_id, "sets": sets}],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _set(reps=8, weight=100.0, set_type="working"):
    return {"reps": reps, "weight": weight, "set_type": set_type}


def test_muscle_volume_counts_this_athletes_sets_only(client, auth, auth2):
    headers, _, _ = auth
    other_headers, _, _ = auth2
    mine = _exercise(client, headers, "E2E Press", ["chest"], ["triceps"])
    theirs = _exercise(client, other_headers, "Their Press", ["chest"])

    _log(client, headers, mine["id"], [_set(), _set(), _set()])
    _log(client, other_headers, theirs["id"], [_set()] * 10)

    rows = client.get("/api/stats/muscles?weeks=1", headers=headers).json()
    by_muscle = {r["muscle"]: r for r in rows["coverage"]}
    assert by_muscle["chest"]["weekly_sets"] == 3.0
    assert by_muscle["triceps"]["weekly_sets"] == 1.5


def test_only_the_requested_window_is_counted(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Row", ["back"])
    _log(client, headers, ex["id"], [_set()] * 4, days_ago=2)
    _log(client, headers, ex["id"], [_set()] * 4, days_ago=40)

    rows = client.get("/api/stats/muscles?weeks=1", headers=headers).json()
    back = next(r for r in rows["coverage"] if r["muscle"] == "back")
    assert back["weekly_sets"] == 4.0  # the 40-day-old session is outside the week


def test_untrained_muscles_come_back_as_gaps(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Curl", ["biceps"])
    _log(client, headers, ex["id"], [_set()] * 3)

    body = client.get("/api/stats/muscles?weeks=1", headers=headers).json()
    missing = {r["muscle"] for r in body["coverage"] if r["status"] == "missing"}
    assert "quadriceps" in missing
    assert "biceps" not in missing


def test_balance_ratios_are_returned_alongside(client, auth):
    headers, _, _ = auth
    push = _exercise(client, headers, "E2E Bench", ["chest"])
    pull = _exercise(client, headers, "E2E Pulldown", ["lats"])
    _log(client, headers, push["id"], [_set()] * 6)
    _log(client, headers, pull["id"], [_set()] * 3)

    body = client.get("/api/stats/muscles?weeks=1", headers=headers).json()
    push_pull = next(r for r in body["ratios"] if r["name"] == "push:pull")
    assert push_pull["ratio"] == 2.0
    assert push_pull["balanced"] is False


def test_an_empty_log_still_answers(client, auth):
    """A brand-new account must get the coverage screen, not an error."""
    headers, _, _ = auth
    body = client.get("/api/stats/muscles", headers=headers).json()
    assert all(r["status"] == "missing" for r in body["coverage"])
    assert body["total_hard_sets"] == 0


def test_exercise_trend_reports_estimated_max_over_time(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Squat", ["quadriceps"])
    _log(client, headers, ex["id"], [_set(reps=5, weight=100)], days_ago=14)
    _log(client, headers, ex["id"], [_set(reps=5, weight=110)], days_ago=1)

    body = client.get(f"/api/stats/exercises/{ex['id']}/trend", headers=headers).json()
    assert body["direction"] == "up"
    assert [p["e1rm"] for p in body["points"]] == [116.67, 128.33]
    assert body["best_e1rm"] == 128.33
    assert body["total_tonnage"] == 1050.0


def test_a_trend_for_something_never_logged_is_empty_not_an_error(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Untouched", ["calves"])
    body = client.get(f"/api/stats/exercises/{ex['id']}/trend", headers=headers).json()
    assert body["points"] == []
    assert body["direction"] == "flat"


def test_suggestions_follow_the_plan_and_the_last_session(client, auth):
    headers, _, _ = auth
    ex = _exercise(client, headers, "E2E Press Up", ["chest"], equipment="barbell")
    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Suggest Day",
            "exercises": [
                {
                    "exercise_id": ex["id"],
                    "order": 0,
                    "target_sets": 3,
                    "target_reps": 6,
                    "target_reps_max": 8,
                }
            ],
        },
    ).json()

    # Nothing logged yet: start at the plan.
    first = client.get(f"/api/workouts/{workout['id']}/suggestions", headers=headers).json()
    assert first[0]["action"] == "start"

    _log(client, headers, ex["id"], [_set(reps=8), _set(reps=8), _set(reps=8)])
    after = client.get(f"/api/workouts/{workout['id']}/suggestions", headers=headers).json()
    assert after[0]["action"] == "add_weight"
    assert after[0]["weight"] == 102.5
    assert after[0]["exercise_id"] == int(ex["id"])


def test_suggestions_are_scoped_to_the_owner(client, auth, auth2):
    headers, _, _ = auth
    other_headers, _, _ = auth2
    ex = _exercise(client, headers, "E2E Private", ["chest"])
    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={"name": "Mine", "exercises": [{"exercise_id": ex["id"], "order": 0}]},
    ).json()

    assert client.get(
        f"/api/workouts/{workout['id']}/suggestions", headers=other_headers
    ).status_code == 404


def test_readiness_reads_when_each_muscle_was_last_trained(client, auth):
    """Inferred from the log's own timing — no wearable, no self-report."""
    headers, _, _ = auth
    chest = _exercise(client, headers, "E2E Fly", ["chest"])
    legs = _exercise(client, headers, "E2E Lunge", ["quadriceps"])
    _log(client, headers, chest["id"], [_set()], days_ago=0)
    _log(client, headers, legs["id"], [_set()], days_ago=3)

    body = client.get("/api/stats/muscles?weeks=1", headers=headers).json()
    by_muscle = {r["muscle"]: r for r in body["readiness"]}
    assert by_muscle["chest"]["status"] == "recovering"
    assert by_muscle["quadriceps"]["status"] == "ready"
    # Never trained at all reads as neglected, with no date to show.
    assert by_muscle["calves"]["days_since"] is None
    assert by_muscle["calves"]["status"] == "neglected"


def test_the_least_recovered_muscle_is_listed_first(client, auth):
    headers, _, _ = auth
    chest = _exercise(client, headers, "E2E Press Today", ["chest"])
    _log(client, headers, chest["id"], [_set()], days_ago=0)

    body = client.get("/api/stats/muscles?weeks=1", headers=headers).json()
    assert body["readiness"][0]["muscle"] == "chest"
