"""A shelf of common foods, so logging a meal isn't a data-entry exercise.

Typing "chicken breast, 200g" and then having to know it's 330 kcal and 62g of
protein is the reason nutrition logging gets abandoned. The database holds the
per-100g (or per-item) figures; the server does the arithmetic, because the
client doing it means two implementations that will eventually disagree.

Figures are round numbers from standard references. They're a starting point
you can edit, not a claim of precision — a chicken breast is not a controlled
quantity.
"""
from __future__ import annotations


def _foods(client, headers, q=""):
    r = client.get(f"/api/nutrition/foods?q={q}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_shelf_covers_the_obvious_staples(client, auth):
    headers, _, _ = auth
    names = " ".join(f["name"].lower() for f in _foods(client, headers))
    for staple in ("chicken breast", "white rice", "egg", "oats", "banana"):
        assert staple in names, f"no {staple} in the food database"


def test_every_food_carries_what_the_maths_needs(client, auth):
    headers, _, _ = auth
    for food in _foods(client, headers):
        assert food["slug"] and food["name"]
        assert food["unit"] in {"100g", "item", "100ml"}
        assert food["calories"] >= 0
        assert food["protein"] >= 0
        assert food["category"]


def test_search_matches_the_way_people_type(client, auth):
    headers, _, _ = auth
    assert any(f["slug"] == "chicken-breast" for f in _foods(client, headers, "chicken"))
    # Case and partial words shouldn't matter.
    assert any(f["slug"] == "chicken-breast" for f in _foods(client, headers, "CHICK"))


def test_searching_for_nothing_known_returns_an_empty_list_not_an_error(client, auth):
    headers, _, _ = auth
    assert _foods(client, headers, "zzzznotafood") == []


def test_logging_a_food_fills_in_the_macros(client, auth):
    """The whole point: pick the food, say how much, and the entry is complete."""
    headers, _, _ = auth
    r = client.post(
        "/api/nutrition",
        headers=headers,
        json={"food": "chicken-breast", "amount": 200},
    )
    assert r.status_code == 201, r.text
    entry = r.json()
    # 100g of chicken breast is 165 kcal / 31g protein, so 200g is double.
    assert entry["calories"] == 330
    assert entry["protein"] == 62.0
    assert "Chicken breast" in entry["label"]
    assert "200" in entry["label"]


def test_a_per_item_food_counts_items_not_grams(client, auth):
    headers, _, _ = auth
    entry = client.post(
        "/api/nutrition", headers=headers, json={"food": "egg", "amount": 3}
    ).json()
    assert entry["calories"] == 234  # 78 kcal an egg
    assert entry["protein"] == 19.5


def test_amount_defaults_to_one_serving(client, auth):
    headers, _, _ = auth
    entry = client.post("/api/nutrition", headers=headers, json={"food": "egg"}).json()
    assert entry["calories"] == 78


def test_what_you_type_still_wins_over_the_database(client, auth):
    """The shelf is a convenience, not an authority — a weighed portion or a
    label you read yourself must not be overwritten."""
    headers, _, _ = auth
    entry = client.post(
        "/api/nutrition",
        headers=headers,
        json={"food": "egg", "amount": 3, "calories": 200, "label": "My eggs"},
    ).json()
    assert entry["calories"] == 200
    assert entry["label"] == "My eggs"
    assert entry["protein"] == 19.5  # still filled in, since it wasn't given


def test_an_unknown_food_is_refused_rather_than_logged_as_zero(client, auth):
    headers, _, _ = auth
    r = client.post("/api/nutrition", headers=headers, json={"food": "unicorn-steak"})
    assert r.status_code == 404


def test_logging_by_hand_still_works_untouched(client, auth):
    headers, _, _ = auth
    entry = client.post(
        "/api/nutrition", headers=headers, json={"label": "Curry", "calories": 700, "protein": 40}
    ).json()
    assert entry["calories"] == 700
    assert entry["label"] == "Curry"
