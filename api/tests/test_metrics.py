"""Body metrics — the weight history every trend reads from.

Until this, `recorded_at` was stamped `now()` unconditionally, so a weigh-in
could only be recorded on the day it happened: the history was a record of when
you remembered, not of what you weigh.
"""
from __future__ import annotations


def _weigh(client, headers, **over):
    payload = {"weight": 82.0}
    payload.update(over)
    r = client.post("/api/metrics", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_a_weigh_in_defaults_to_now(client, auth):
    headers, _, _ = auth
    assert _weigh(client, headers)["recorded_at"] is not None


def test_a_weigh_in_can_be_filled_in_for_a_day_you_forgot(client, auth):
    headers, _, _ = auth
    row = _weigh(client, headers, weight=81.4, recorded_at="2026-07-27T08:00:00")
    assert row["recorded_at"] == "2026-07-27T08:00:00"
    assert row["weight"] == 81.4


def test_timestamps_come_back_as_naive_utc(client, auth):
    """The API stores naive UTC everywhere; an offset here would make the
    client's parseServerDate double-count it."""
    headers, _, _ = auth
    row = _weigh(client, headers, recorded_at="2026-07-27T10:00:00+02:00")
    assert row["recorded_at"] == "2026-07-27T08:00:00"


def test_metrics_come_back_newest_first(client, auth):
    headers, _, _ = auth
    _weigh(client, headers, weight=83, recorded_at="2026-07-01T08:00:00")
    _weigh(client, headers, weight=81, recorded_at="2026-07-29T08:00:00")
    _weigh(client, headers, weight=82, recorded_at="2026-07-15T08:00:00")
    assert [m["weight"] for m in client.get("/api/metrics", headers=headers).json()] == [
        81,
        82,
        83,
    ]


def test_the_latest_weigh_in_reaches_the_coachs_copy(client, auth):
    # Home and the coach read the profile; BodyMetric stays the history.
    headers, _, _ = auth
    _weigh(client, headers, weight=81.4)
    assert client.get("/api/profile", headers=headers).json()["current_weight"] == 81.4


def test_filling_in_an_older_weigh_in_leaves_the_current_one_alone(client, auth):
    headers, _, _ = auth
    _weigh(client, headers, weight=81.4, recorded_at="2026-08-01T08:00:00")
    _weigh(client, headers, weight=90.0, recorded_at="2026-01-01T08:00:00")
    # Backfilling last January is not a claim about what you weigh now.
    assert client.get("/api/profile", headers=headers).json()["current_weight"] == 81.4


def test_a_metric_without_a_weight_does_not_clear_the_current_one(client, auth):
    headers, _, _ = auth
    _weigh(client, headers, weight=81.4)
    _weigh(client, headers, weight=None, body_fat=14.2)
    assert client.get("/api/profile", headers=headers).json()["current_weight"] == 81.4


def test_metrics_are_private_to_their_owner(client, auth):
    headers, _, _ = auth
    mine = _weigh(client, headers)

    other = client.post(
        "/api/auth/register",
        json={"email": "metric-other@example.com", "password": "secret123"},
    ).json()
    theirs = {"Authorization": f"Bearer {other['token']}"}

    assert client.get("/api/metrics", headers=theirs).json() == []
    assert client.delete(f"/api/metrics/{mine['id']}", headers=theirs).status_code == 404
    assert client.delete(f"/api/metrics/{mine['id']}", headers=headers).status_code == 204
