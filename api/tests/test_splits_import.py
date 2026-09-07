"""POST /api/splits/import — a reviewed plan applied once, and only once.

The import used to be walked by the client: create a split, then a workout per
day, then a custom exercise per unmatched movement. A failure halfway left a
half-built split behind, and the obvious "try again" built a second one next to
it. These pin the two things that fixes: it is atomic, and it reconciles.
"""
from __future__ import annotations


def _catalog_id(client, headers, name: str) -> int:
    rows = client.get("/api/exercises", headers=headers, params={"q": name}).json()["items"]
    return rows[0]["id"]


def _plan(client, headers, **over):
    payload = {
        "name": "PPL",
        "rules": ["Top of the range on every set -> add weight"],
        "workouts": [
            {
                "name": "Push",
                "weekdays": [1],
                "exercises": [
                    {
                        "exercise_id": _catalog_id(client, headers, "Bench"),
                        "target_sets": 3,
                        "target_reps": 8,
                        "target_reps_max": 12,
                    },
                    {"custom_name": "Cable Face Pull", "target_sets": 3, "target_reps": 15},
                ],
            },
            {
                "name": "Legs",
                "weekdays": [4],
                "exercises": [{"exercise_id": _catalog_id(client, headers, "Squat"), "target_sets": 5}],
            },
        ],
    }
    payload.update(over)
    return payload


def test_import_creates_the_whole_plan_in_one_call(client, auth):
    headers, _, _ = auth
    r = client.post("/api/splits/import", headers=headers, json=_plan(client, headers))
    assert r.status_code == 201, r.text
    body = r.json()

    assert body["created_workouts"] == 2
    assert body["updated_workouts"] == 0
    assert body["created_exercises"] == 1  # the unmatched face pull
    split = body["split"]
    assert split["is_active"] is True
    assert split["rules"] == ["Top of the range on every set -> add weight"]
    assert [w["name"] for w in split["workouts"]] == ["Push", "Legs"]
    assert len(split["workouts"][0]["exercises"]) == 2
    assert split["workouts"][0]["exercises"][0]["target_reps_max"] == 12


def test_unmatched_movement_becomes_an_exercise_you_own(client, auth):
    headers, _, _ = auth
    client.post("/api/splits/import", headers=headers, json=_plan(client, headers))
    rows = client.get("/api/exercises", headers=headers, params={"q": "Face Pull"}).json()["items"]
    assert len(rows) == 1
    assert rows[0]["is_custom"] is True
    assert rows[0]["owner_id"] is not None


def test_a_retry_under_the_same_key_does_not_import_twice(client, auth):
    headers, _, _ = auth
    payload = _plan(client, headers)
    key = {"Idempotency-Key": "import-abc"}

    first = client.post("/api/splits/import", headers={**headers, **key}, json=payload)
    second = client.post("/api/splits/import", headers={**headers, **key}, json=payload)

    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["split"]["id"] == second.json()["split"]["id"]
    assert len(client.get("/api/splits", headers=headers).json()) == 1


def test_without_a_key_a_second_import_is_a_second_plan(client, auth):
    # Not a bug: importing the same text twice on purpose has to be possible.
    # The client varies the key with the payload, so only a *retry* replays.
    headers, _, _ = auth
    payload = _plan(client, headers)
    client.post("/api/splits/import", headers=headers, json=payload)
    client.post("/api/splits/import", headers=headers, json=payload)
    assert len(client.get("/api/splits", headers=headers).json()) == 2


def test_replacing_reconciles_instead_of_stacking_another_plan(client, auth):
    headers, _, _ = auth
    first = client.post("/api/splits/import", headers=headers, json=_plan(client, headers)).json()
    split_id = first["split"]["id"]
    push_id = next(w["id"] for w in first["split"]["workouts"] if w["name"] == "Push")

    revised = _plan(client, headers)
    revised["replace_split_id"] = split_id
    revised["workouts"][0]["weekdays"] = [2]  # Push moved to Tuesday
    revised["workouts"].append(
        {"name": "Pull", "weekdays": [3], "exercises": [{"custom_name": "Chin Up"}]}
    )
    r = client.post("/api/splits/import", headers=headers, json=revised)
    assert r.status_code == 201, r.text
    body = r.json()

    assert body["created_workouts"] == 1  # Pull
    assert body["updated_workouts"] == 2  # Push, Legs
    assert body["removed_workouts"] == 0
    assert body["split"]["id"] == split_id
    assert len(client.get("/api/splits", headers=headers).json()) == 1
    # The matched day keeps its id, so anything already logged against it still
    # points at the plan it came from.
    push = next(w for w in body["split"]["workouts"] if w["name"] == "Push")
    assert push["id"] == push_id
    assert push["weekdays"] == [2]


def test_replacing_reuses_a_custom_exercise_rather_than_duplicating_it(client, auth):
    headers, _, _ = auth
    first = client.post("/api/splits/import", headers=headers, json=_plan(client, headers)).json()
    revised = _plan(client, headers)
    revised["replace_split_id"] = first["split"]["id"]

    body = client.post("/api/splits/import", headers=headers, json=revised).json()
    assert body["created_exercises"] == 0
    assert body["reused_exercises"] == 1
    rows = client.get("/api/exercises", headers=headers, params={"q": "Face Pull"}).json()
    assert rows["total"] == 1


def test_a_day_dropped_from_the_plan_is_removed_and_its_history_detached(client, auth):
    headers, _, _ = auth
    first = client.post("/api/splits/import", headers=headers, json=_plan(client, headers)).json()
    legs_id = next(w["id"] for w in first["split"]["workouts"] if w["name"] == "Legs")
    session = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": legs_id}
    ).json()

    revised = _plan(client, headers)
    revised["replace_split_id"] = first["split"]["id"]
    revised["workouts"] = [revised["workouts"][0]]  # Legs is gone

    body = client.post("/api/splits/import", headers=headers, json=revised).json()
    assert body["removed_workouts"] == 1
    assert [w["name"] for w in body["split"]["workouts"]] == ["Push"]

    # The logged bout survives; it just no longer claims to come from a plan day
    # that doesn't exist. A dangling id would let the rotation count it.
    kept = client.get(f"/api/sessions/{session['id']}", headers=headers)
    assert kept.status_code == 200
    assert kept.json()["source_workout_id"] is None


def test_a_bad_exercise_id_imports_nothing_at_all(client, auth):
    headers, _, _ = auth
    payload = _plan(client, headers)
    payload["workouts"][1]["exercises"][0]["exercise_id"] = 999999

    r = client.post("/api/splits/import", headers=headers, json=payload)
    assert r.status_code == 400
    # Atomic: no split, no half-built plan, and no orphan custom exercise from
    # the day that would have succeeded.
    assert client.get("/api/splits", headers=headers).json() == []
    assert client.get("/api/exercises", headers=headers, params={"q": "Face Pull"}).json()["total"] == 0


def test_a_row_with_neither_a_match_nor_a_name_is_rejected(client, auth):
    headers, _, _ = auth
    payload = _plan(client, headers)
    payload["workouts"][0]["exercises"][1] = {"target_sets": 3}
    r = client.post("/api/splits/import", headers=headers, json=payload)
    assert r.status_code == 422


def test_import_cannot_touch_someone_elses_split(client, auth):
    headers, _, _ = auth
    mine = client.post("/api/splits/import", headers=headers, json=_plan(client, headers)).json()

    other = client.post(
        "/api/auth/register",
        json={"email": "other-import@example.com", "password": "secret123", "display_name": "O"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}

    payload = _plan(client, other_headers)
    payload["replace_split_id"] = mine["split"]["id"]
    r = client.post("/api/splits/import", headers=other_headers, json=payload)
    assert r.status_code == 404


def test_importing_deactivates_the_previous_plan(client, auth):
    headers, _, _ = auth
    old = client.post("/api/splits", headers=headers, json={"name": "Old"}).json()
    client.patch(f"/api/splits/{old['id']}", headers=headers, json={"is_active": True})

    client.post("/api/splits/import", headers=headers, json=_plan(client, headers))
    splits = {s["name"]: s["is_active"] for s in client.get("/api/splits", headers=headers).json()}
    assert splits == {"Old": False, "PPL": True}
