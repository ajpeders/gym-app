"""Plan-day (Workout) CRUD: weekdays/floating round-trip + weekday validation."""


def _first_exercise_id(client, headers):
    items = client.get("/api/exercises", headers=headers).json()["items"]
    return items[0]["id"]


def test_workout_crud_roundtrips_weekdays_and_floating(client, auth):
    headers, _, _ = auth
    ex_id = _first_exercise_id(client, headers)

    created = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Upper",
            "weekdays": [1, 3, 5],
            "floating": False,
            "order": 2,
            "exercises": [
                {
                    "exercise_id": ex_id,
                    "order": 0,
                    "target_sets": 4,
                    "target_reps": 8,
                    "target_weight": 20,
                    "target_weight_max": 25,
                    "target_duration_seconds": 20,
                    "target_duration_seconds_max": 60,
                }
            ],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    wid = body["id"]
    assert body["weekdays"] == [1, 3, 5]
    assert body["floating"] is False
    assert body["order"] == 2
    assert len(body["exercises"]) == 1
    exercise = body["exercises"][0]
    assert exercise["target_weight"] == 20
    assert exercise["target_weight_max"] == 25
    assert exercise["target_duration_seconds"] == 20
    assert exercise["target_duration_seconds_max"] == 60

    # Single fetch round-trips the same values.
    one = client.get(f"/api/workouts/{wid}", headers=headers).json()
    assert one["weekdays"] == [1, 3, 5]
    assert one["floating"] is False

    # Partial PATCH (only floating) must NOT clear weekdays or reset order.
    patched = client.patch(
        f"/api/workouts/{wid}", headers=headers, json={"floating": True}
    )
    assert patched.status_code == 200, patched.text
    pb = patched.json()
    assert pb["floating"] is True
    assert pb["weekdays"] == [1, 3, 5]
    assert pb["order"] == 2

    # Update weekdays explicitly.
    upd = client.patch(
        f"/api/workouts/{wid}", headers=headers, json={"weekdays": [0, 6]}
    )
    assert upd.status_code == 200
    assert upd.json()["weekdays"] == [0, 6]

    # Listed.
    listed = client.get("/api/workouts", headers=headers).json()
    assert any(w["id"] == wid for w in listed)

    assert client.delete(f"/api/workouts/{wid}", headers=headers).status_code == 204


def test_workout_rejects_bad_weekdays(client, auth):
    headers, _, _ = auth

    out_of_range = client.post(
        "/api/workouts", headers=headers,
        json={"name": "Bad", "weekdays": [7], "exercises": []},
    )
    assert out_of_range.status_code == 422, out_of_range.text

    duplicate = client.post(
        "/api/workouts", headers=headers,
        json={"name": "Bad", "weekdays": [1, 1], "exercises": []},
    )
    assert duplicate.status_code == 422, duplicate.text
