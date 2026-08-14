"""Take everything with you.

`DELETE /auth/me` has existed for a while; the other half of the launch
checklist's data story is being able to get your training out first. Deleting
an account you can't export is a one-way door.

The export is deliberately checked against the same list `delete_me` sweeps —
anything the account owns, you can take.
"""
from __future__ import annotations


def _seed(client, headers) -> None:
    ex_id = client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"]
    split = client.post("/api/splits", headers=headers, json={"name": "PPL"}).json()
    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Push",
            "split_id": split["id"],
            "exercises": [{"exercise_id": ex_id, "order": 0, "target_sets": 3}],
        },
    ).json()
    session = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": workout["id"]}
    ).json()
    client.post(
        f"/api/sessions/{session['id']}/exercises/{session['exercises'][0]['id']}/sets",
        headers=headers,
        json={"reps": 10, "weight": 60.0},
    )
    client.post("/api/metrics", headers=headers, json={"weight": 82.5})
    client.post("/api/exercises", headers=headers, json={"name": "Sled Push"})


def test_the_export_carries_the_whole_account(client, auth):
    headers, _, _ = auth
    _seed(client, headers)

    r = client.get("/api/auth/me/export", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["user"]["email"]
    assert data["settings"] is not None
    assert len(data["splits"]) >= 1
    assert len(data["workouts"]) >= 1
    assert len(data["sessions"]) >= 1
    assert len(data["body_metrics"]) >= 1
    assert len(data["custom_exercises"]) >= 1


def test_the_logged_sets_come_with_it(client, auth):
    """A training log without the sets is not a training log."""
    headers, _, _ = auth
    _seed(client, headers)

    data = client.get("/api/auth/me/export", headers=headers).json()
    sets = [s for sess in data["sessions"] for we in sess["exercises"] for s in we["sets"]]
    assert [s["reps"] for s in sets] == [10]


def test_the_export_says_when_it_was_taken(client, auth):
    headers, _, _ = auth
    data = client.get("/api/auth/me/export", headers=headers).json()
    assert data["exported_at"]
    assert data["format_version"] >= 1


def test_no_password_hash_ever_leaves(client, auth):
    headers, _, _ = auth
    body = client.get("/api/auth/me/export", headers=headers).text
    assert "password" not in body.lower()


def test_another_account_is_not_in_your_export(client, auth):
    import uuid

    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": f"exp-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    _seed(client, other_headers)

    mine = client.get("/api/auth/me/export", headers=headers).json()
    assert all(s["name"] != "PPL" for s in mine["splits"]) or not mine["splits"]
    assert all(e["name"] != "Sled Push" for e in mine["custom_exercises"])


def test_the_shared_catalog_is_not_dumped_into_your_export(client, auth):
    """828 rows you don't own is noise, not your data."""
    headers, _, _ = auth
    data = client.get("/api/auth/me/export", headers=headers).json()
    assert len(data["custom_exercises"]) < 50


def test_the_export_needs_authentication(client):
    assert client.get("/api/auth/me/export").status_code in (401, 403)
