"""Rest between sets is recorded on the set that follows the rest.

The client logs sets through an offline queue, so a set has no server id until
it syncs — recording rest on the NEXT set's create keeps it to a single write
that survives being offline, instead of needing a PATCH of the previous set.
"""


def _exercise_id(client, headers):
    return client.get("/api/exercises", headers=headers).json()["items"][0]["id"]


def _session_with_exercise(client, headers):
    sid = client.post("/api/sessions", headers=headers, json={"name": "Rest test"}).json()["id"]
    se_id = client.post(
        f"/api/sessions/{sid}/exercises",
        headers=headers,
        json={"exercise_id": _exercise_id(client, headers)},
    ).json()["id"]
    return sid, se_id


def test_rest_seconds_round_trips_on_create(client, auth):
    headers, _, _ = auth
    sid, se_id = _session_with_exercise(client, headers)

    created = client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers,
        json={"reps": 8, "weight": 60.0, "rest_seconds": 95},
    )
    assert created.status_code == 201, created.text
    assert created.json()["rest_seconds"] == 95

    fetched = client.get(f"/api/sessions/{sid}", headers=headers).json()
    assert fetched["exercises"][0]["sets"][0]["rest_seconds"] == 95


def test_rest_seconds_defaults_to_null(client, auth):
    """The first set of a session has no preceding rest."""
    headers, _, _ = auth
    sid, se_id = _session_with_exercise(client, headers)

    created = client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers,
        json={"reps": 5},
    )
    assert created.status_code == 201, created.text
    assert created.json()["rest_seconds"] is None


def test_rest_seconds_can_be_patched(client, auth):
    headers, _, _ = auth
    sid, se_id = _session_with_exercise(client, headers)
    set_id = client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers,
        json={"reps": 8},
    ).json()["id"]

    patched = client.patch(
        f"/api/sessions/{sid}/exercises/{se_id}/sets/{set_id}",
        headers=headers,
        json={"rest_seconds": 120},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["rest_seconds"] == 120


def test_planned_rest_is_snapshotted_onto_the_session(client, auth):
    """The live timer counts towards the plan's rest, so it has to travel with
    the session — like every other target."""
    headers, _, _ = auth
    ex = client.post(
        "/api/exercises",
        headers=headers,
        json={"name": "E2E Rest Lift", "category": "strength", "equipment": "barbell",
              "primary_muscles": ["chest"], "instructions": []},
    ).json()
    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Rest Day",
            "exercises": [{"exercise_id": ex["id"], "order": 0, "rest_seconds": 120}],
        },
    ).json()

    session = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": str(workout["id"])}
    ).json()
    assert session["exercises"][0]["rest_seconds"] == 120
