"""Split scheduling: GET /api/splits/today derives what's due + done-this-week."""


def _mk_workout(client, headers, split_id, name, weekdays, floating):
    r = client.post("/api/workouts", headers=headers, json={
        "name": name, "split_id": split_id, "weekdays": weekdays,
        "floating": floating, "exercises": []})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_today_marks_fixed_and_floating(client, auth):
    headers, _, _ = auth
    split = client.post("/api/splits", headers=headers, json={"name": "PPL"}).json()
    client.patch(f"/api/splits/{split['id']}", headers=headers, json={"is_active": True})
    wid = _mk_workout(client, headers, split["id"], "Full", list(range(7)), False)
    today = client.get("/api/splits/today", headers=headers)
    assert today.status_code == 200
    items = today.json()
    assert any(w["id"] == wid for w in items)
    assert all(w["done_this_week"] is False for w in items)
    client.post("/api/sessions/start", headers=headers, json={"workout_id": wid})
    again = client.get("/api/splits/today", headers=headers)
    assert next(w for w in again.json() if w["id"] == wid)["done_this_week"] is True
