"""The calculator endpoints — units, defaults, and who can call them."""
from __future__ import annotations


def test_plates_default_to_a_20kg_bar(client, auth):
    headers, _, _ = auth
    body = client.get("/api/tools/plates?target=100", headers=headers).json()
    assert body["bar"] == 20
    assert sum(body["per_side"]) == 40
    assert body["achievable"] == 100


def test_pounds_bring_the_pound_bar_and_plates(client, auth):
    headers, _, _ = auth
    body = client.get("/api/tools/plates?target=225&units=lb", headers=headers).json()
    assert body["bar"] == 45
    assert body["per_side"] == [45, 45]


def test_an_unloadable_target_says_what_it_can_do(client, auth):
    headers, _, _ = auth
    body = client.get("/api/tools/plates?target=101", headers=headers).json()
    assert body["achievable"] == 100
    assert body["leftover"] == 1


def test_a_custom_bar_is_respected(client, auth):
    """Not every bar is 20kg — trap bars, women's bars, the smith machine."""
    headers, _, _ = auth
    body = client.get("/api/tools/plates?target=60&bar=15", headers=headers).json()
    assert body["bar"] == 15
    assert body["achievable"] == 60


def test_warmup_starts_at_the_bar(client, auth):
    headers, _, _ = auth
    sets = client.get("/api/tools/warmup?weight=100", headers=headers).json()
    assert sets[0] == {"weight": 20, "reps": 10}
    assert all(s["weight"] < 100 for s in sets)


def test_one_rep_max_returns_the_percentage_table(client, auth):
    headers, _, _ = auth
    body = client.get("/api/tools/one-rep-max?weight=100&reps=5", headers=headers).json()
    assert body["estimate"] == 116.67
    assert body["percentages"]["80%"] == 93.34


def test_nonsense_input_is_rejected_by_validation(client, auth):
    headers, _, _ = auth
    assert client.get("/api/tools/plates?target=0", headers=headers).status_code == 422
    assert client.get("/api/tools/one-rep-max?weight=100&reps=0", headers=headers).status_code == 422


def test_the_calculators_need_an_account(client):
    """Not because the maths is secret — because every route here is scoped,
    and one that isn't is the one that gets forgotten about."""
    assert client.get("/api/tools/plates?target=100").status_code == 401
