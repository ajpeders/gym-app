"""Calorie / protein log: timestamped entries plus daily targets.

Entries carry a real time so a day is a sequence of meals, not one number.
The server returns a flat recent window and lets the client group by *local*
day — there is no per-user timezone stored anywhere, so grouping server-side
would silently use UTC boundaries.
"""
from datetime import datetime, timedelta, timezone


def test_create_and_list_entry(client, auth):
    headers, _, _ = auth
    created = client.post(
        "/api/nutrition",
        headers=headers,
        json={"label": "Chicken and rice", "calories": 800, "protein": 60},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["label"] == "Chicken and rice"
    assert body["calories"] == 800
    assert body["protein"] == 60
    # Defaults to now so the common case is one tap.
    assert body["eaten_at"] is not None

    listed = client.get("/api/nutrition", headers=headers)
    assert listed.status_code == 200, listed.text
    assert any(e["id"] == body["id"] for e in listed.json())


def test_entry_time_can_be_supplied(client, auth):
    """Logging a meal after the fact must keep the time it was actually eaten."""
    headers, _, _ = auth
    when = (datetime.now(timezone.utc) - timedelta(days=2, hours=3)).replace(microsecond=0)
    created = client.post(
        "/api/nutrition",
        headers=headers,
        json={"label": "Breakfast", "calories": 450, "protein": 30, "eaten_at": when.isoformat()},
    )
    assert created.status_code == 201, created.text
    assert created.json()["eaten_at"].startswith(when.strftime("%Y-%m-%dT%H:%M"))


def test_list_window_excludes_older_entries(client, auth):
    headers, _, _ = auth
    old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    client.post(
        "/api/nutrition",
        headers=headers,
        json={"label": "Ancient", "calories": 100, "eaten_at": old},
    )
    client.post("/api/nutrition", headers=headers, json={"label": "Fresh", "calories": 200})

    labels = [e["label"] for e in client.get("/api/nutrition?days=7", headers=headers).json()]
    assert "Fresh" in labels
    assert "Ancient" not in labels


def test_entries_are_per_user(client, auth):
    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": "nutri@example.com", "password": "secret123", "display_name": "Other"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}

    client.post("/api/nutrition", headers=other_headers, json={"label": "Theirs", "calories": 999})
    labels = [e["label"] for e in client.get("/api/nutrition", headers=headers).json()]
    assert "Theirs" not in labels


def test_delete_entry(client, auth):
    headers, _, _ = auth
    entry_id = client.post(
        "/api/nutrition", headers=headers, json={"label": "Oops", "calories": 10}
    ).json()["id"]

    assert client.delete(f"/api/nutrition/{entry_id}", headers=headers).status_code == 204
    assert all(e["id"] != entry_id for e in client.get("/api/nutrition", headers=headers).json())


def test_cannot_delete_another_users_entry(client, auth):
    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": "nutri2@example.com", "password": "secret123", "display_name": "Other"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    entry_id = client.post(
        "/api/nutrition", headers=other_headers, json={"label": "Theirs", "calories": 5}
    ).json()["id"]

    assert client.delete(f"/api/nutrition/{entry_id}", headers=headers).status_code == 404


def test_daily_targets_round_trip_on_profile(client, auth):
    headers, _, _ = auth
    patched = client.patch(
        "/api/profile", headers=headers, json={"calorie_target": 2400, "protein_target": 180}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["calorie_target"] == 2400
    assert patched.json()["protein_target"] == 180

    fetched = client.get("/api/profile", headers=headers).json()
    assert fetched["calorie_target"] == 2400
    assert fetched["protein_target"] == 180


def test_update_entry(client, auth):
    """Entries are editable after the fact — a wrong number or time is common."""
    headers, _, _ = auth
    entry_id = client.post(
        "/api/nutrition", headers=headers, json={"label": "Guess", "calories": 500}
    ).json()["id"]

    patched = client.patch(
        f"/api/nutrition/{entry_id}",
        headers=headers,
        json={"label": "Actually measured", "calories": 620, "protein": 45},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["label"] == "Actually measured"
    assert body["calories"] == 620
    assert body["protein"] == 45


def test_update_can_move_an_entry_in_time(client, auth):
    headers, _, _ = auth
    entry_id = client.post(
        "/api/nutrition", headers=headers, json={"label": "Late log", "calories": 300}
    ).json()["id"]
    when = (datetime.now(timezone.utc) - timedelta(hours=5)).replace(microsecond=0)

    patched = client.patch(
        f"/api/nutrition/{entry_id}", headers=headers, json={"eaten_at": when.isoformat()}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["eaten_at"].startswith(when.strftime("%Y-%m-%dT%H:%M"))
    # Untouched fields survive a partial update.
    assert patched.json()["calories"] == 300


def test_cannot_update_another_users_entry(client, auth):
    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": "nutri3@example.com", "password": "secret123", "display_name": "Other"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    entry_id = client.post(
        "/api/nutrition", headers=other_headers, json={"label": "Theirs", "calories": 5}
    ).json()["id"]

    assert client.patch(
        f"/api/nutrition/{entry_id}", headers=headers, json={"calories": 1}
    ).status_code == 404
