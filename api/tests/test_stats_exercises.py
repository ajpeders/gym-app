"""Per-exercise personal records (GET /stats/exercises).

Powers the PR / min–max line shown next to each exercise in a workout, so it
must be queryable for several exercise ids at once and must ignore other
users' training.
"""


def _exercise_ids(client, headers, n=2):
    items = client.get("/api/exercises", headers=headers).json()["items"]
    return [item["id"] for item in items[:n]]


def _log(client, headers, ex_id, sets, name="PR test"):
    """Log a session of (reps, weight) sets against one exercise."""
    sid = client.post("/api/sessions", headers=headers, json={"name": name}).json()["id"]
    se_id = client.post(
        f"/api/sessions/{sid}/exercises", headers=headers, json={"exercise_id": ex_id}
    ).json()["id"]
    for reps, weight in sets:
        client.post(
            f"/api/sessions/{sid}/exercises/{se_id}/sets",
            headers=headers,
            json={"reps": reps, "weight": weight},
        )
    return sid


def test_reports_best_and_range_for_one_exercise(client, auth):
    headers, _, _ = auth
    ex_id = _exercise_ids(client, headers, 1)[0]
    _log(client, headers, ex_id, [(10, 60.0), (8, 72.5), (12, 55.0)])

    resp = client.get(f"/api/stats/exercises?exercise_ids={ex_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    by_id = {row["exercise_id"]: row for row in resp.json()}
    stat = by_id[ex_id]

    assert stat["best_weight"] == 72.5
    assert stat["best_weight_reps"] == 8  # reps from the heaviest set, not the most
    assert stat["min_weight"] == 55.0
    assert stat["max_weight"] == 72.5
    assert stat["max_reps"] == 12
    assert stat["set_count"] == 3
    assert stat["last_performed_at"] is not None


def test_batches_several_exercises_and_reports_untrained_as_null(client, auth):
    headers, _, _ = auth
    trained, untrained = _exercise_ids(client, headers, 2)
    _log(client, headers, trained, [(5, 100.0)])

    resp = client.get(
        f"/api/stats/exercises?exercise_ids={trained}&exercise_ids={untrained}",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    by_id = {row["exercise_id"]: row for row in resp.json()}

    assert by_id[trained]["best_weight"] == 100.0
    # An exercise the user has never logged still gets a row, with empty stats,
    # so the UI can render "no history yet" without a second request.
    assert untrained in by_id
    assert by_id[untrained]["best_weight"] is None
    assert by_id[untrained]["set_count"] == 0


def test_ignores_other_users_sets(client, auth):
    headers, _, _ = auth
    rival = client.post(
        "/api/auth/register",
        json={"email": "prrival@example.com", "password": "secret123", "display_name": "Rival"},
    ).json()
    other_headers = {"Authorization": f"Bearer {rival['token']}"}
    ex_id = _exercise_ids(client, headers, 1)[0]

    _log(client, other_headers, ex_id, [(1, 500.0)], name="Rival")
    _log(client, headers, ex_id, [(10, 40.0)], name="Mine")

    resp = client.get(f"/api/stats/exercises?exercise_ids={ex_id}", headers=headers)
    stat = {row["exercise_id"]: row for row in resp.json()}[ex_id]
    assert stat["best_weight"] == 40.0


def test_bodyweight_sets_do_not_become_a_zero_weight_pr(client, auth):
    """A set logged without a weight must not report min_weight 0."""
    headers, _, _ = auth
    ex_id = _exercise_ids(client, headers, 1)[0]
    _log(client, headers, ex_id, [(12, None), (6, 80.0)])

    resp = client.get(f"/api/stats/exercises?exercise_ids={ex_id}", headers=headers)
    stat = {row["exercise_id"]: row for row in resp.json()}[ex_id]
    assert stat["min_weight"] == 80.0
    assert stat["max_weight"] == 80.0
    assert stat["max_reps"] == 12
    assert stat["set_count"] == 2
