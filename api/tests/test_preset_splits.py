"""Well-known programs, adoptable in one tap.

A new account's home screen is empty, and "build a split" is a lot to ask of
someone who just wants to train on Monday. These are the standard answers —
PPL, Upper/Lower, Full Body, Starting Strength, a bro split — stored as data
and turned into an ordinary split when adopted.

Two rules the tests exist to hold:

* **Copy on adopt, never a live link.** What you adopt is yours to edit; the
  preset must not change under you, and your edits must not change it.
* **Exercises resolve through the same matcher everything else uses.** The
  presets name movements in English; the catalog decides which row that is.
"""
from __future__ import annotations

import os

import pytest

from app import presets as preset_library


@pytest.fixture(autouse=True)
def preset_catalog():
    """Global catalog rows for every movement the presets name.

    The shared fixture seeds two exercises, which would leave every adopted
    program almost empty and make these tests assert nothing. Inserted as
    global rows (no owner), which is what the real catalog is.
    """
    from app.db import SessionLocal
    from app.models import Exercise

    names = sorted(
        {
            item["exercise"]
            for preset in preset_library.PRESETS
            for day in preset["days"]
            for item in day["exercises"]
        }
    )
    db = SessionLocal()
    try:
        existing = {e.name for e in db.query(Exercise).all()}
        db.add_all(
            [
                Exercise(
                    name=name,
                    category="strength",
                    equipment="barbell",
                    primary_muscles=["chest"],
                    secondary_muscles=[],
                    instructions=[],
                    images=[],
                )
                for name in names
                if name not in existing
            ]
        )
        db.commit()
    finally:
        db.close()


def _presets(client, headers):
    r = client.get("/api/splits/presets", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_the_library_lists_recognisable_programs(client, auth):
    headers, _, _ = auth
    slugs = {p["slug"] for p in _presets(client, headers)}
    assert {"ppl", "upper-lower", "full-body-3x", "starting-strength"} <= slugs


def test_each_preset_describes_itself_well_enough_to_choose_from(client, auth):
    headers, _, _ = auth
    for preset in _presets(client, headers):
        assert preset["name"]
        assert preset["description"]
        assert preset["days_per_week"] >= 1
        assert preset["days"], f"{preset['slug']} has no days"
        for day in preset["days"]:
            assert day["name"]
            assert day["exercises"], f"{preset['slug']}/{day['name']} is empty"


def test_a_rotation_program_is_marked_as_one(client, auth):
    """PPL is a cycle, not a week — adopting it should not invent weekdays."""
    headers, _, _ = auth
    ppl = next(p for p in _presets(client, headers) if p["slug"] == "ppl")
    assert ppl["mode"] == "rolling"


def test_adopting_creates_a_real_split_owned_by_the_athlete(client, auth):
    headers, _, _ = auth
    r = client.post("/api/splits/presets/upper-lower/adopt", headers=headers)
    assert r.status_code == 201, r.text
    split = r.json()["split"]

    assert split["name"]
    assert split["mode"] == "rigid"
    assert len(split["workouts"]) >= 2
    assert all(w["exercises"] for w in split["workouts"])
    # It's just a split from here on.
    assert client.get(f"/api/splits/{split['id']}", headers=headers).status_code == 200


def test_adopted_days_keep_the_programs_order_and_targets(client, auth):
    headers, _, _ = auth
    body = client.post("/api/splits/presets/ppl/adopt", headers=headers).json()
    days = sorted(body["split"]["workouts"], key=lambda w: w["order"])

    assert [w["name"] for w in days] == ["Push", "Pull", "Legs"]
    first = days[0]["exercises"][0]
    assert first["target_sets"] >= 1
    assert first["target_reps"] >= 1


def test_a_rolling_preset_adopts_with_no_weekdays(client, auth):
    headers, _, _ = auth
    body = client.post("/api/splits/presets/ppl/adopt", headers=headers).json()
    assert all(w["weekdays"] == [] for w in body["split"]["workouts"])


def test_a_weekday_preset_adopts_onto_weekdays(client, auth):
    headers, _, _ = auth
    body = client.post("/api/splits/presets/upper-lower/adopt", headers=headers).json()
    assert all(w["weekdays"] for w in body["split"]["workouts"])


def test_adopting_is_a_copy_so_editing_it_changes_nothing_else(client, auth):
    headers, _, _ = auth
    first = client.post("/api/splits/presets/ppl/adopt", headers=headers).json()["split"]
    client.patch(f"/api/splits/{first['id']}", headers=headers, json={"name": "My PPL"})

    second = client.post("/api/splits/presets/ppl/adopt", headers=headers).json()["split"]
    assert second["id"] != first["id"]
    assert second["name"] != "My PPL"  # the preset is untouched
    assert _presets(client, headers)  # and still listed


def test_adopting_reports_anything_the_catalog_could_not_match(client, auth):
    """Silently dropping an exercise leaves a program that isn't the program."""
    headers, _, _ = auth
    body = client.post("/api/splits/presets/ppl/adopt", headers=headers).json()
    assert "unmatched" in body
    assert isinstance(body["unmatched"], list)


def test_an_unknown_preset_is_a_404_not_an_empty_split(client, auth):
    headers, _, _ = auth
    assert client.post("/api/splits/presets/nope/adopt", headers=headers).status_code == 404


def test_adopting_does_not_steal_the_active_split(client, auth):
    """Adopting is browsing, not switching — someone mid-program who taps a
    preset to look at it must not lose their plan."""
    headers, _, _ = auth
    mine = client.post("/api/splits", headers=headers, json={"name": "Mine"}).json()
    client.patch(f"/api/splits/{mine['id']}", headers=headers, json={"is_active": True})

    client.post("/api/splits/presets/ppl/adopt", headers=headers)

    still_active = [s for s in client.get("/api/splits", headers=headers).json() if s["is_active"]]
    assert [s["id"] for s in still_active] == [mine["id"]]


def test_the_first_split_you_adopt_becomes_active(client, auth):
    """With no plan at all, adopting one and then having to go activate it is a
    pointless second step."""
    headers, _, _ = auth
    body = client.post("/api/splits/presets/ppl/adopt", headers=headers).json()
    assert body["split"]["is_active"] is True


def test_presets_are_readable_by_the_spotter(client, auth):
    """The AI grounds its suggestions in these instead of freelancing a plan."""
    headers, _, _ = auth
    tools = client.get("/api/companion/manifest").json()["tools"]
    names = " ".join(t.get("name", "") + t.get("description", "") for t in tools)
    assert "preset" in names.lower()


# --- against the catalog that actually ships -------------------------------

_DEV_DB = os.path.join(os.path.dirname(__file__), "..", "data", "gym.db")


@pytest.mark.skipif(not os.path.exists(_DEV_DB), reason="no seeded catalog available")
def test_the_presets_resolve_against_the_real_catalog() -> None:
    """Every preset movement must match something in the shipped wger catalog.

    The fixture above makes the other tests deterministic by inserting exactly
    the names the presets use — which would happily hide a preset naming a lift
    the real catalog has never heard of. This checks the names against the 828
    rows that actually ship, and is skipped where that database isn't present
    (CI has no catalog).
    """
    import sqlite3

    from app.ai.service import _match, _norm  # noqa: PLC2701 - matcher internals by design

    conn = sqlite3.connect(_DEV_DB)
    catalog = [
        (row[0], row[1], frozenset(_norm(row[1])))
        for row in conn.execute("select id, name from exercise where owner_id is null")
    ]
    conn.close()
    assert len(catalog) > 100, "expected the full catalog in the dev database"

    missing = []
    for preset in preset_library.PRESETS:
        for day in preset["days"]:
            for item in day["exercises"]:
                ex_id, _, _ = _match(item["exercise"], catalog)
                if ex_id is None:
                    missing.append(f"{preset['slug']}/{item['exercise']}")

    assert not missing, f"presets name movements the catalog doesn't have: {missing}"
