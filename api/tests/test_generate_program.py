"""Generating a program, with a stubbed model.

The model's only job is proposing structure; everything that turns that into
something trainable — catalog matching, rep-range normalisation, timed-movement
repair — is the same deterministic pipeline a pasted program goes through. So
these tests stub the provider and check the pipeline, which is the part that
can be wrong in a way nobody notices.
"""
from __future__ import annotations

import pytest

from app.ai import service


class StubProvider:
    """A provider that returns whatever it was handed."""

    name = "stub"
    model = "stub-1"

    def __init__(self, payload: dict):
        self.payload = payload
        self.system: str | None = None
        self.user: str | None = None

    async def complete_json(self, system: str, user: str, schema: dict) -> dict:
        self.system, self.user = system, user
        return self.payload


PROGRAM = {
    "reply": "Upper/Lower, twice each.",
    "workouts": [
        {
            "name": "Upper",
            "weekdays": [1],
            "exercises": [
                {"exercise": "Barbell Bench Press", "target_sets": 4, "target_reps": 6,
                 "target_reps_max": 8},
                {"exercise": "Zercher Widget Pull", "target_sets": 3, "target_reps": 10},
            ],
        },
        {
            "name": "Lower",
            "weekdays": [4],
            "exercises": [
                {"exercise": "Barbell Squat", "target_sets": 4, "target_reps": 5},
            ],
        },
    ],
}


@pytest.fixture
def stub(monkeypatch):
    provider = StubProvider(PROGRAM)
    monkeypatch.setattr(service, "_resolve", lambda db, user: (provider, "kg"))
    return provider


async def _generate(db, user, **kwargs):
    return await service.generate_program(db, user, **kwargs)


def test_the_generated_days_come_back_matched_to_the_catalog(client, auth, stub):
    import anyio

    from app.db import SessionLocal
    from app.models import User

    headers, user_dict, _ = auth
    db = SessionLocal()
    try:
        user = db.get(User, int(user_dict["id"]))
        result = anyio.run(lambda: _generate(db, user, goal="get stronger", days_per_week=2))
    finally:
        db.close()

    assert [w["name"] for w in result["workouts"]] == ["Upper", "Lower"]
    bench = result["workouts"][0]["exercises"][0]
    # Matched against the catalog, so it carries a real id — not a name the
    # client has to resolve later.
    assert bench["exercise_id"] is not None
    assert bench["target_reps"] == 6 and bench["target_reps_max"] == 8


def test_a_movement_the_catalog_lacks_is_flagged_not_silently_kept(client, auth, stub):
    import anyio

    from app.db import SessionLocal
    from app.models import User

    headers, user_dict, _ = auth
    db = SessionLocal()
    try:
        user = db.get(User, int(user_dict["id"]))
        result = anyio.run(lambda: _generate(db, user))
    finally:
        db.close()

    invented = result["workouts"][0]["exercises"][1]
    assert invented["exercise_name"] == "Zercher Widget Pull"
    assert invented["match"] in {"none", "fuzzy"}


def test_what_the_model_is_told_includes_the_constraints(client, auth, stub):
    import anyio

    from app.db import SessionLocal
    from app.models import User

    headers, user_dict, _ = auth
    db = SessionLocal()
    try:
        user = db.get(User, int(user_dict["id"]))
        anyio.run(
            lambda: _generate(
                db, user, goal="hypertrophy", days_per_week=4, experience="intermediate",
                equipment="dumbbells only",
            )
        )
    finally:
        db.close()

    assert "hypertrophy" in stub.user
    assert "4" in stub.user
    assert "dumbbells only" in stub.user
    # And the rules that keep the output usable.
    assert "catalog" in stub.system.lower()
    assert "never set a target weight" in stub.system.lower()


def test_the_endpoint_says_so_when_no_provider_is_configured(client, auth):
    """No stub here: nothing is set up in tests, which is the real-world case
    of asking for a program before configuring AI."""
    headers, _, _ = auth
    r = client.post("/api/ai/generate-program", headers=headers, json={"goal": "strength"})
    assert r.status_code == 502
    assert "set up" in r.json()["detail"].lower()
