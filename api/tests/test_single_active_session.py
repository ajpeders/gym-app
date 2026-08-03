"""At most one session may be in progress at a time.

Starting a workout used to create a session unconditionally from every entry
point, so a stray tap left the previous one open forever — three were live
during user testing. The guard lives on the server because the client has
several start paths and localStorage only ever tracks the newest.

Strays are FINISHED, never deleted: the offline queue drops a set permanently
on a 4xx (lib/offline.ts), so deleting a session that still has sets queued on
someone's phone would silently lose them.
"""


def _open_ids(client, headers) -> list[int]:
    rows = client.get("/api/sessions?limit=50", headers=headers).json()["items"]
    return [s["id"] for s in rows if s["finished_at"] is None]


def test_starting_a_session_finishes_the_previous_one(client, auth):
    headers, _, _ = auth
    first = client.post("/api/sessions/start", headers=headers, json={"name": "One"}).json()
    second = client.post("/api/sessions/start", headers=headers, json={"name": "Two"}).json()

    assert _open_ids(client, headers) == [second["id"]]
    closed = client.get(f"/api/sessions/{first['id']}", headers=headers).json()
    assert closed["finished_at"] is not None


def test_the_stray_is_kept_not_deleted(client, auth):
    """Its sets must survive — an offline device may still be syncing to it."""
    headers, _, _ = auth
    ex_id = str(client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"])
    first = client.post("/api/sessions/start", headers=headers, json={"name": "One"}).json()
    se = client.post(
        f"/api/sessions/{first['id']}/exercises", headers=headers, json={"exercise_id": ex_id}
    ).json()
    client.post(
        f"/api/sessions/{first['id']}/exercises/{se['id']}/sets",
        headers=headers,
        json={"reps": 5, "weight": 100.0, "set_type": "normal"},
    )

    client.post("/api/sessions/start", headers=headers, json={"name": "Two"})

    kept = client.get(f"/api/sessions/{first['id']}", headers=headers)
    assert kept.status_code == 200
    assert [s["reps"] for s in kept.json()["exercises"][0]["sets"]] == [5]


def test_a_finished_stray_still_accepts_queued_sets(client, auth):
    """The offline queue keeps POSTing sets after the fact; closing must not 4xx."""
    headers, _, _ = auth
    ex_id = str(client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"])
    first = client.post("/api/sessions/start", headers=headers, json={"name": "One"}).json()
    se = client.post(
        f"/api/sessions/{first['id']}/exercises", headers=headers, json={"exercise_id": ex_id}
    ).json()

    client.post("/api/sessions/start", headers=headers, json={"name": "Two"})

    late = client.post(
        f"/api/sessions/{first['id']}/exercises/{se['id']}/sets",
        headers=headers,
        json={"reps": 8, "weight": 50.0, "set_type": "normal"},
    )
    assert late.status_code == 201, late.text


def test_logging_a_past_session_leaves_a_live_one_alone(client, auth):
    """/sessions/log records something already done — it is not "starting"."""
    headers, _, _ = auth
    live = client.post("/api/sessions/start", headers=headers, json={"name": "Live"}).json()
    client.post(
        "/api/sessions/log",
        headers=headers,
        json={"name": "Yesterday", "started_at": "2026-07-30T12:00:00", "exercises": []},
    )
    assert _open_ids(client, headers) == [live["id"]]


def test_another_users_session_is_untouched(client, auth):
    import uuid

    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    theirs = client.post(
        "/api/sessions/start", headers=other_headers, json={"name": "Theirs"}
    ).json()

    client.post("/api/sessions/start", headers=headers, json={"name": "Mine"})

    still_open = client.get(f"/api/sessions/{theirs['id']}", headers=other_headers).json()
    assert still_open["finished_at"] is None


def test_active_endpoint_reports_the_open_session(client, auth):
    headers, _, _ = auth
    assert client.get("/api/sessions/active", headers=headers).json() is None

    started = client.post("/api/sessions/start", headers=headers, json={"name": "One"}).json()
    active = client.get("/api/sessions/active", headers=headers).json()
    assert active is not None and active["id"] == started["id"]

    client.post(f"/api/sessions/{started['id']}/finish", headers=headers)
    assert client.get("/api/sessions/active", headers=headers).json() is None
