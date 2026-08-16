"""The manual half of recovery: how today feels.

The scoring is unit-tested in test_analysis. These cover the check-in itself —
one per day, partial answers accepted, and nobody else's mornings.
"""
from __future__ import annotations

from datetime import date, timedelta


def test_a_check_in_comes_back_scored(client, auth):
    headers, _, _ = auth
    r = client.post(
        "/api/readiness", headers=headers, json={"sleep_hours": 8, "soreness": 1, "energy": 5}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["score"] >= 80
    assert body["status"] == "good"
    assert body["advice"]


def test_checking_in_twice_updates_today_rather_than_stacking(client, auth):
    """You get one morning per day."""
    headers, _, _ = auth
    client.post("/api/readiness", headers=headers, json={"sleep_hours": 5})
    client.post("/api/readiness", headers=headers, json={"soreness": 4})

    rows = client.get("/api/readiness", headers=headers).json()
    assert len(rows) == 1
    # And the second check-in didn't wipe the first answer.
    assert rows[0]["sleep_hours"] == 5
    assert rows[0]["soreness"] == 4


def test_a_single_answer_is_enough(client, auth):
    headers, _, _ = auth
    body = client.post("/api/readiness", headers=headers, json={"soreness": 5}).json()
    assert body["score"] is not None
    assert body["advice"]


def test_an_empty_check_in_is_not_scored_as_a_terrible_day(client, auth):
    """Saying nothing must not read as awful."""
    headers, _, _ = auth
    body = client.post("/api/readiness", headers=headers, json={}).json()
    assert body["score"] is None
    assert body["status"] is None


def test_wearable_shaped_fields_are_accepted_now_so_a_watch_can_fill_them_later(client, auth):
    headers, _, _ = auth
    body = client.post(
        "/api/readiness", headers=headers, json={"resting_hr": 52, "hrv_ms": 68, "sleep_hours": 7.5}
    ).json()
    assert body["resting_hr"] == 52
    assert body["hrv_ms"] == 68


def test_nonsense_values_are_refused(client, auth):
    headers, _, _ = auth
    assert client.post("/api/readiness", headers=headers, json={"soreness": 9}).status_code == 422
    assert client.post(
        "/api/readiness", headers=headers, json={"sleep_hours": 40}
    ).status_code == 422


def test_history_is_scoped_to_the_athlete(client, auth, auth2):
    headers, _, _ = auth
    other_headers, _, _ = auth2
    client.post("/api/readiness", headers=headers, json={"sleep_hours": 8})
    assert client.get("/api/readiness", headers=other_headers).json() == []


def test_an_older_day_can_be_backfilled(client, auth):
    headers, _, _ = auth
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    client.post("/api/readiness", headers=headers, json={"day": yesterday, "sleep_hours": 6})
    client.post("/api/readiness", headers=headers, json={"sleep_hours": 8})

    rows = client.get("/api/readiness", headers=headers).json()
    assert [r["day"] for r in rows] == [date.today().isoformat(), yesterday]
