"""Stats summary reflects logged sessions + their set volume."""


def _first_exercise_id(client, headers):
    items = client.get("/api/exercises", headers=headers).json()["items"]
    return items[0]["id"]


def test_summary_counts_session_and_volume(client, auth):
    headers, _, _ = auth
    ex_id = _first_exercise_id(client, headers)

    # Log a session with two completed sets: 10x60 + 8x65 = 600 + 520 = 1120.
    sess = client.post("/api/sessions", headers=headers, json={"name": "Vol"})
    sid = sess.json()["id"]
    se = client.post(
        f"/api/sessions/{sid}/exercises", headers=headers, json={"exercise_id": ex_id}
    )
    se_id = se.json()["id"]
    client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers, json={"reps": 10, "weight": 60.0},
    )
    client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers, json={"reps": 8, "weight": 65.0},
    )

    # Still in progress: not a session yet, on any screen.
    data = client.get("/api/stats/summary", headers=headers).json()
    assert data["total_workouts"] == 0
    assert data["this_week"] == 0
    assert data["streak"] == 0

    client.post(f"/api/sessions/{sid}/finish", headers=headers)
    summary = client.get("/api/stats/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    data = summary.json()
    assert data["total_workouts"] == 1
    assert data["this_week"] == 1
    assert data["streak"] == 1
    total_volume = sum(w["volume"] for w in data["volume_by_week"])
    assert total_volume == 1120.0
