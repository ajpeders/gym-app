"""Replaying a queued write must not duplicate it.

The offline queue retries anything it couldn't confirm, and "couldn't confirm"
includes the case where the server committed and the response never made it
back. Sets have always had this hole; extending the queue to starting and
finishing a workout makes it much worse, because a replayed start would trip
the single-active-session guard and close the session you are standing in.

So every write the queue can replay carries an Idempotency-Key, and the server
returns the first response instead of doing the work twice.
"""
from __future__ import annotations

import uuid


def _key() -> str:
    return uuid.uuid4().hex


def _open_ids(client, headers) -> list[int]:
    rows = client.get("/api/sessions?limit=50", headers=headers).json()["items"]
    return [s["id"] for s in rows if s["finished_at"] is None]


def test_replaying_a_start_returns_the_same_session(client, auth):
    headers, _, _ = auth
    key = {"Idempotency-Key": _key(), **headers}

    first = client.post("/api/sessions/start", headers=key, json={"name": "Push"})
    second = client.post("/api/sessions/start", headers=key, json={"name": "Push"})

    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert len(_open_ids(client, headers)) == 1


def test_a_replayed_start_does_not_close_the_session_it_created(client, auth):
    """Without this, walking out of a dead zone ends the workout you're doing."""
    headers, _, _ = auth
    key = {"Idempotency-Key": _key(), **headers}

    started = client.post("/api/sessions/start", headers=key, json={"name": "Pull"}).json()
    client.post("/api/sessions/start", headers=key, json={"name": "Pull"})

    still_open = client.get(f"/api/sessions/{started['id']}", headers=headers).json()
    assert still_open["finished_at"] is None


def test_two_different_keys_really_do_start_two_sessions(client, auth):
    """The guard must not turn into 'you can never start a second workout'."""
    headers, _, _ = auth
    first = client.post(
        "/api/sessions/start", headers={"Idempotency-Key": _key(), **headers}, json={"name": "A"}
    ).json()
    second = client.post(
        "/api/sessions/start", headers={"Idempotency-Key": _key(), **headers}, json={"name": "B"}
    ).json()

    assert first["id"] != second["id"]


def test_a_start_with_no_key_behaves_exactly_as_before(client, auth):
    headers, _, _ = auth
    first = client.post("/api/sessions/start", headers=headers, json={"name": "A"}).json()
    second = client.post("/api/sessions/start", headers=headers, json={"name": "B"}).json()

    assert first["id"] != second["id"]
    assert _open_ids(client, headers) == [second["id"]]


def test_replaying_a_logged_set_does_not_log_it_twice(client, auth):
    headers, _, _ = auth
    ex_id = client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"]
    sid = client.post("/api/sessions", headers=headers, json={"name": "S"}).json()["id"]
    se = client.post(
        f"/api/sessions/{sid}/exercises", headers=headers, json={"exercise_id": ex_id}
    ).json()["id"]

    key = {"Idempotency-Key": _key(), **headers}
    body = {"reps": 8, "weight": 60.0}
    client.post(f"/api/sessions/{sid}/exercises/{se}/sets", headers=key, json=body)
    client.post(f"/api/sessions/{sid}/exercises/{se}/sets", headers=key, json=body)

    fetched = client.get(f"/api/sessions/{sid}", headers=headers).json()
    assert len(fetched["exercises"][0]["sets"]) == 1


def test_replaying_an_added_exercise_does_not_add_it_twice(client, auth):
    headers, _, _ = auth
    ex_id = client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"]
    sid = client.post("/api/sessions", headers=headers, json={"name": "S"}).json()["id"]

    key = {"Idempotency-Key": _key(), **headers}
    body = {"exercise_id": ex_id}
    a = client.post(f"/api/sessions/{sid}/exercises", headers=key, json=body)
    b = client.post(f"/api/sessions/{sid}/exercises", headers=key, json=body)

    assert a.json()["id"] == b.json()["id"]
    assert len(client.get(f"/api/sessions/{sid}", headers=headers).json()["exercises"]) == 1


def test_one_users_key_never_collides_with_anothers(client, auth):
    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": f"idem-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    shared = _key()

    mine = client.post(
        "/api/sessions/start", headers={"Idempotency-Key": shared, **headers}, json={"name": "M"}
    ).json()
    theirs = client.post(
        "/api/sessions/start",
        headers={"Idempotency-Key": shared, "Authorization": f"Bearer {other['token']}"},
        json={"name": "T"},
    ).json()

    assert mine["id"] != theirs["id"]


def test_a_failed_write_is_not_remembered_as_done(client, auth):
    """A 4xx must be retryable once the client fixes it — never cached."""
    headers, _, _ = auth
    key = {"Idempotency-Key": _key(), **headers}
    sid = client.post("/api/sessions", headers=headers, json={"name": "S"}).json()["id"]

    bad = client.post(
        f"/api/sessions/{sid}/exercises", headers=key, json={"exercise_id": 999999}
    )
    assert bad.status_code == 400

    ex_id = client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"]
    good = client.post(
        f"/api/sessions/{sid}/exercises", headers=key, json={"exercise_id": ex_id}
    )
    assert good.status_code == 201, good.text


def test_finishing_twice_keeps_the_first_end_time(client, auth):
    """A queued finish can arrive long after the fact — and after the
    single-active-session guard already closed the session. It must not move
    the end time to whenever the phone found signal again."""
    headers, _, _ = auth
    sid = client.post("/api/sessions", headers=headers, json={"name": "S"}).json()["id"]

    first = client.post(f"/api/sessions/{sid}/finish", headers=headers).json()
    second = client.post(f"/api/sessions/{sid}/finish", headers=headers).json()

    assert second["finished_at"] == first["finished_at"]


def test_a_finish_can_carry_the_time_it_actually_happened(client, auth):
    """You tap Finish in the basement; it syncs two hours later."""
    headers, _, _ = auth
    sid = client.post(
        "/api/sessions", headers=headers, json={"name": "S", "started_at": "2026-08-01T17:00:00"}
    ).json()["id"]

    done = client.post(
        f"/api/sessions/{sid}/finish", headers=headers, json={"finished_at": "2026-08-01T18:05:00"}
    )
    assert done.status_code == 200, done.text
    assert done.json()["finished_at"].startswith("2026-08-01T18:05")
