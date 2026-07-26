"""Workout lifecycle: create, add exercise, log set, fetch history; routines + stats."""


def _first_exercise_id(client, headers):
    items = client.get("/api/exercises", headers=headers).json()["items"]
    return items[0]["id"]


def test_workout_full_flow(client, auth):
    headers, _, _ = auth
    ex_id = _first_exercise_id(client, headers)

    # Start an empty workout.
    w = client.post("/api/workouts", headers=headers, json={"name": "Push Day"})
    assert w.status_code == 201, w.text
    workout = w.json()
    assert workout["finished_at"] is None
    wid = workout["id"]

    # Add an exercise.
    we = client.post(
        f"/api/workouts/{wid}/exercises", headers=headers, json={"exercise_id": ex_id}
    )
    assert we.status_code == 201, we.text
    we_id = we.json()["id"]
    assert we.json()["order"] == 0

    # Log two sets.
    s1 = client.post(
        f"/api/workouts/{wid}/exercises/{we_id}/sets",
        headers=headers,
        json={"reps": 10, "weight": 60.0},
    )
    assert s1.status_code == 201, s1.text
    assert s1.json()["set_number"] == 1
    assert s1.json()["set_type"] == "working"

    s2 = client.post(
        f"/api/workouts/{wid}/exercises/{we_id}/sets",
        headers=headers,
        json={"reps": 8, "weight": 65.0, "rpe": 8.5, "set_type": "working"},
    )
    assert s2.status_code == 201
    assert s2.json()["set_number"] == 2
    set_id = s2.json()["id"]

    # Patch a set.
    patched = client.patch(
        f"/api/workouts/{wid}/exercises/{we_id}/sets/{set_id}",
        headers=headers,
        json={"reps": 9},
    )
    assert patched.status_code == 200
    assert patched.json()["reps"] == 9

    # Finish the workout.
    fin = client.post(f"/api/workouts/{wid}/finish", headers=headers)
    assert fin.status_code == 200
    assert fin.json()["finished_at"] is not None

    # History contains it with nested exercises + sets.
    hist = client.get("/api/workouts", headers=headers)
    assert hist.status_code == 200
    body = hist.json()
    assert body["total"] >= 1
    found = next(w for w in body["items"] if w["id"] == wid)
    assert len(found["exercises"]) == 1
    assert len(found["exercises"][0]["sets"]) == 2

    # Single fetch.
    one = client.get(f"/api/workouts/{wid}", headers=headers)
    assert one.status_code == 200
    assert one.json()["exercises"][0]["exercise"]["id"] == ex_id

    # Delete a set.
    d = client.delete(
        f"/api/workouts/{wid}/exercises/{we_id}/sets/{set_id}", headers=headers
    )
    assert d.status_code == 204


def test_start_from_routine_prefills(client, auth):
    headers, _, _ = auth
    ex_id = _first_exercise_id(client, headers)

    routine = client.post(
        "/api/routines",
        headers=headers,
        json={
            "name": "Leg Day",
            "notes": "heavy",
            "exercises": [
                {
                    "exercise_id": ex_id,
                    "order": 0,
                    "target_sets": 3,
                    "target_reps": 5,
                    "rest_seconds": 180,
                }
            ],
        },
    )
    assert routine.status_code == 201, routine.text
    rid = routine.json()["id"]
    assert len(routine.json()["exercises"]) == 1

    started = client.post(
        "/api/workouts/start", headers=headers, json={"routine_id": rid}
    )
    assert started.status_code == 201, started.text
    data = started.json()
    assert data["source_routine_id"] == rid
    assert data["name"] == "Leg Day"
    assert len(data["exercises"]) == 1
    assert data["exercises"][0]["exercise_id"] == ex_id


def test_workout_isolation_between_users(client, auth):
    headers, _, _ = auth
    w = client.post("/api/workouts", headers=headers, json={"name": "Private"})
    wid = w.json()["id"]

    import uuid

    other = client.post(
        "/api/auth/register",
        json={"email": f"iso-{uuid.uuid4().hex[:6]}@x.com", "password": "abcdef"},
    ).json()
    oh = {"Authorization": f"Bearer {other['token']}"}
    assert client.get(f"/api/workouts/{wid}", headers=oh).status_code == 404
    assert client.get("/api/workouts", headers=oh).json()["total"] == 0


def test_settings_and_stats(client, auth):
    headers, _, _ = auth

    s = client.get("/api/settings", headers=headers)
    assert s.status_code == 200
    assert s.json()["units"] == "kg"

    upd = client.patch(
        "/api/settings",
        headers=headers,
        json={"units": "lb", "feature_flags": {"in_set_prompts": True}},
    )
    assert upd.status_code == 200
    assert upd.json()["units"] == "lb"
    # Merge preserves existing flags.
    assert upd.json()["feature_flags"]["quick_buttons"] is True
    assert upd.json()["feature_flags"]["in_set_prompts"] is True

    stats = client.get("/api/stats/summary", headers=headers)
    assert stats.status_code == 200
    payload = stats.json()
    assert "total_workouts" in payload
    assert "this_week" in payload
    assert isinstance(payload["recent_prs"], list)
    assert isinstance(payload["volume_by_week"], list)


def test_metrics_crud(client, auth):
    headers, _, _ = auth
    created = client.post(
        "/api/metrics",
        headers=headers,
        json={"weight": 80.5, "body_fat": 15.0, "measurements": {"waist": 84}},
    )
    assert created.status_code == 201, created.text
    mid = created.json()["id"]

    listed = client.get("/api/metrics", headers=headers)
    assert listed.status_code == 200
    assert any(m["id"] == mid for m in listed.json())

    assert client.delete(f"/api/metrics/{mid}", headers=headers).status_code == 204
