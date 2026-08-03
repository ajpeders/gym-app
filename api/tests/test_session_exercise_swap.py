"""PATCH /sessions/{id}/exercises/{se_id} — swap the movement, keep the work.

The everyday case is a machine being occupied: you did the sets, just on a
different exercise than planned. Delete + re-add was the only route before,
and it threw away every set already logged.
"""


def _two_exercise_ids(client, headers) -> tuple[str, str]:
    rows = client.get("/api/exercises?limit=2", headers=headers).json()["items"]
    return str(rows[0]["id"]), str(rows[1]["id"])


def _session_with_sets(client, headers, exercise_id: str) -> tuple[int, int]:
    """A live session with one exercise carrying two logged sets."""
    sid = client.post("/api/sessions/start", headers=headers, json={}).json()["id"]
    se = client.post(
        f"/api/sessions/{sid}/exercises",
        headers=headers,
        json={"exercise_id": exercise_id},
    ).json()
    for reps, weight in ((10, 60.0), (8, 65.0)):
        r = client.post(
            f"/api/sessions/{sid}/exercises/{se['id']}/sets",
            headers=headers,
            json={"reps": reps, "weight": weight, "set_type": "normal"},
        )
        assert r.status_code == 201, r.text
    return sid, se["id"]


def test_swapping_keeps_the_logged_sets(client, auth):
    headers, _, _ = auth
    first, second = _two_exercise_ids(client, headers)
    sid, se_id = _session_with_sets(client, headers, first)

    r = client.patch(
        f"/api/sessions/{sid}/exercises/{se_id}",
        headers=headers,
        json={"exercise_id": second},
    )
    assert r.status_code == 200, r.text
    assert str(r.json()["exercise_id"]) == second

    session = client.get(f"/api/sessions/{sid}", headers=headers).json()
    (row,) = session["exercises"]
    assert str(row["exercise_id"]) == second
    # The whole point: the work survives the swap.
    assert [(s["reps"], s["weight"]) for s in row["sets"]] == [(10, 60.0), (8, 65.0)]


def test_swapping_keeps_its_position_in_the_session(client, auth):
    headers, _, _ = auth
    first, second = _two_exercise_ids(client, headers)
    sid = client.post("/api/sessions/start", headers=headers, json={}).json()["id"]
    a = client.post(
        f"/api/sessions/{sid}/exercises", headers=headers, json={"exercise_id": first}
    ).json()
    client.post(
        f"/api/sessions/{sid}/exercises", headers=headers, json={"exercise_id": second}
    )

    r = client.patch(
        f"/api/sessions/{sid}/exercises/{a['id']}",
        headers=headers,
        json={"exercise_id": second},
    )
    assert r.status_code == 200, r.text
    session = client.get(f"/api/sessions/{sid}", headers=headers).json()
    # Swapping must not reorder the session — the swapped row stays first.
    assert [e["id"] for e in session["exercises"]][0] == a["id"]
    assert str(session["exercises"][0]["exercise_id"]) == second


def test_swapping_works_on_an_already_finished_session(client, auth):
    """Correcting a past day is the other half of the feature."""
    headers, _, _ = auth
    first, second = _two_exercise_ids(client, headers)
    logged = client.post(
        "/api/sessions/log",
        headers=headers,
        json={
            "name": "Past day",
            "started_at": "2026-07-30T12:00:00",
            "exercises": [
                {"exercise_id": first, "sets": [{"reps": 12, "weight": 40.0}]}
            ],
        },
    ).json()
    se_id = logged["exercises"][0]["id"]

    r = client.patch(
        f"/api/sessions/{logged['id']}/exercises/{se_id}",
        headers=headers,
        json={"exercise_id": second},
    )
    assert r.status_code == 200, r.text
    session = client.get(f"/api/sessions/{logged['id']}", headers=headers).json()
    assert str(session["exercises"][0]["exercise_id"]) == second
    assert [s["reps"] for s in session["exercises"][0]["sets"]] == [12]


def test_unknown_exercise_is_rejected(client, auth):
    """400, matching _validate_exercise — the same answer add/log already give."""
    headers, _, _ = auth
    first, _ = _two_exercise_ids(client, headers)
    sid, se_id = _session_with_sets(client, headers, first)

    r = client.patch(
        f"/api/sessions/{sid}/exercises/{se_id}",
        headers=headers,
        json={"exercise_id": "999999"},
    )
    assert r.status_code == 400
    # The row must be untouched by a rejected swap.
    session = client.get(f"/api/sessions/{sid}", headers=headers).json()
    assert str(session["exercises"][0]["exercise_id"]) == first


def test_another_users_session_cannot_be_swapped(client, auth):
    import uuid

    headers, _, _ = auth
    first, second = _two_exercise_ids(client, headers)
    sid, se_id = _session_with_sets(client, headers, first)

    other = client.post(
        "/api/auth/register",
        json={"email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}

    r = client.patch(
        f"/api/sessions/{sid}/exercises/{se_id}",
        headers=other_headers,
        json={"exercise_id": second},
    )
    assert r.status_code == 404
