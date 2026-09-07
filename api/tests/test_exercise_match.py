"""POST /api/exercises/match — catalog matching with no model involved.

The same matcher the AI import uses, exposed on its own so a CSV or JSON plan
(already structured — nothing to infer) imports without an AI provider.
"""
from __future__ import annotations


def test_match_resolves_names_to_the_catalog(client, auth):
    headers, _, _ = auth
    r = client.post(
        "/api/exercises/match",
        headers=headers,
        json={"names": ["Barbell Bench Press", "Barbell Squat"]},
    )
    assert r.status_code == 200, r.text
    by_name = {m["name"]: m for m in r.json()}
    assert by_name["Barbell Bench Press"]["match"] == "exact"
    assert by_name["Barbell Bench Press"]["exercise_id"] is not None
    assert by_name["Barbell Squat"]["matched_name"] == "Barbell Squat"


def test_match_preserves_order_and_reports_misses(client, auth):
    headers, _, _ = auth
    names = ["Barbell Squat", "Kettlebell Windmill Thing"]
    r = client.post("/api/exercises/match", headers=headers, json={"names": names})
    out = r.json()
    assert [m["name"] for m in out] == names
    # A miss is reported, not substituted — the import turns it into a custom
    # exercise you own rather than logging it as something you didn't do.
    assert out[1]["exercise_id"] is None
    assert out[1]["match"] == "none"


def test_match_sees_your_own_custom_exercises(client, auth):
    headers, _, _ = auth
    client.post("/api/exercises", headers=headers, json={"name": "Cable Face Pull"})
    r = client.post("/api/exercises/match", headers=headers, json={"names": ["Cable Face Pull"]})
    assert r.json()[0]["match"] == "exact"


def test_match_does_not_see_someone_elses_custom_exercises(client, auth):
    headers, _, _ = auth
    client.post("/api/exercises", headers=headers, json={"name": "Alex Special Raise"})

    other = client.post(
        "/api/auth/register",
        json={"email": "other-match@example.com", "password": "secret123", "display_name": "O"},
    ).json()
    r = client.post(
        "/api/exercises/match",
        headers={"Authorization": f"Bearer {other['token']}"},
        json={"names": ["Alex Special Raise"]},
    )
    assert r.json()[0]["exercise_id"] is None


def test_match_requires_auth(client):
    assert client.post("/api/exercises/match", json={"names": ["Squat"]}).status_code == 401


def test_match_accepts_an_empty_list(client, auth):
    headers, _, _ = auth
    assert client.post("/api/exercises/match", headers=headers, json={"names": []}).json() == []
