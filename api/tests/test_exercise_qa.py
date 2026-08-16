"""Asking about a movement, grounded in the catalog's own entry.

"RAG over the exercise DB" turns out to be a primary-key lookup: there is
exactly one relevant document — the exercise on screen. That's what makes the
answer checkable, and what the tests pin: the model is handed that entry, told
to answer from it, and told to say when it doesn't cover the question.
"""
from __future__ import annotations

import anyio
import pytest

from app.ai import service
from app.ai.base import AIError


class StubProvider:
    name = "stub"
    model = "stub-1"

    def __init__(self):
        self.system = None
        self.messages = None

    async def complete_text(self, system, messages):
        self.system, self.messages = system, messages

        class Completion:
            text = "  Keep your elbows tucked and press.  "

        return Completion()


@pytest.fixture
def stub(monkeypatch):
    provider = StubProvider()
    monkeypatch.setattr(service, "_resolve", lambda db, user: (provider, "kg"))
    return provider


def _ask(user_dict, exercise_id, question="How do I do this?"):
    from app.db import SessionLocal
    from app.models import User

    db = SessionLocal()
    try:
        user = db.get(User, int(user_dict["id"]))
        return anyio.run(lambda: service.exercise_qa(db, user, exercise_id, question))
    finally:
        db.close()


def _catalog_exercise(client, headers, q="bench"):
    rows = client.get(f"/api/exercises?q={q}&limit=1", headers=headers).json()
    items = rows if isinstance(rows, list) else rows["items"]
    return items[0]


def test_the_answer_comes_back_trimmed_and_attributed(client, auth, stub):
    headers, user, _ = auth
    exercise = _catalog_exercise(client, headers)

    result = _ask(user, int(exercise["id"]))
    assert result["answer"] == "Keep your elbows tucked and press."
    assert result["exercise_name"] == exercise["name"]
    assert result["provider"] == "stub"


def test_the_model_is_handed_the_catalog_entry(client, auth, stub):
    headers, user, _ = auth
    exercise = _catalog_exercise(client, headers)

    _ask(user, int(exercise["id"]), "Where should the bar touch?")

    sent = stub.messages[0].content
    assert exercise["name"] in sent
    assert "Where should the bar touch?" in sent
    # The instructions are the grounding; without them there's nothing to answer from.
    assert "Catalog instructions" in sent


def test_an_entry_with_no_instructions_is_marked_ungrounded(client, auth, stub):
    """338 of 828 catalog rows have gaps. An answer from an empty entry is
    worth less trust, and the client says so."""
    headers, user, _ = auth
    bare = client.post(
        "/api/exercises",
        headers=headers,
        json={"name": "E2E Bare Movement", "category": "strength", "equipment": "barbell",
              "primary_muscles": ["chest"], "instructions": []},
    ).json()

    result = _ask(user, int(bare["id"]))
    assert result["grounded"] is False
    assert "none recorded" in stub.messages[0].content


def test_the_rules_keep_it_short_and_out_of_medical_territory(client, auth, stub):
    headers, user, _ = auth
    _ask(user, int(_catalog_exercise(client, headers)["id"]), "my shoulder hurts on this")

    system = stub.system.lower()
    assert "two or three sentences" in system
    assert "do not diagnose" in system


def test_you_cannot_ask_about_someone_elses_custom_exercise(client, auth, auth2, stub):
    headers, _, _ = auth
    other_headers, other, _ = auth2
    mine = client.post(
        "/api/exercises",
        headers=headers,
        json={"name": "E2E Private Move", "category": "strength", "equipment": "barbell",
              "primary_muscles": ["chest"], "instructions": ["Lift."]},
    ).json()

    with pytest.raises(AIError):
        _ask(other, int(mine["id"]))


def test_the_endpoint_says_so_when_no_provider_is_configured(client, auth):
    headers, _, _ = auth
    exercise = _catalog_exercise(client, headers)
    r = client.post(
        "/api/ai/exercise-qa",
        headers=headers,
        json={"exercise_id": int(exercise["id"]), "question": "how?"},
    )
    assert r.status_code == 502
    assert "set up" in r.json()["detail"].lower()
