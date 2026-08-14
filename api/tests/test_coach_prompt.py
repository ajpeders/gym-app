"""The coach executes; it does not opine.

The original prompt told the model to "coach with conviction: give ONE clear
recommendation" and to produce a full session (exercise — sets×reps — load) on
request. Pointed at a 7B local model that is a machine for producing confident
programming advice from nothing, which is the one thing an app that could get
someone injured must not do.

So the coach's job is now narrow and checkable: map what the user said to a
tool call, read the result back, ask when genuinely ambiguous. Any actual
guidance has to come from deterministic code (the progression rule, volume
math) that the coach merely surfaces.

Prompt wording is the weakest of the controls, which is exactly why it's
pinned here — the persona is easy to reintroduce by accident.
"""
from __future__ import annotations

from app.ai.prompts import coach_system_prompt

PROMPT = coach_system_prompt("Alex", "", "")


def test_the_coach_is_told_not_to_volunteer_advice() -> None:
    assert "do not volunteer" in PROMPT.lower()


def test_the_coach_may_not_invent_numbers() -> None:
    """Every figure it states must trace to a tool result or the profile."""
    lowered = PROMPT.lower()
    assert "never state a number" in lowered


def test_the_old_give_a_recommendation_instruction_is_gone() -> None:
    lowered = PROMPT.lower()
    assert "coach with conviction" not in lowered
    assert "one clear recommendation" not in lowered


def test_it_is_no_longer_told_to_program_a_session() -> None:
    """Writing someone a session out of a small model's imagination is the
    highest-consequence thing this app could do wrong."""
    assert "sets×reps" not in PROMPT
    assert "concrete ordered session" not in PROMPT


def test_the_tough_love_persona_is_gone() -> None:
    lowered = PROMPT.lower()
    for trait in ("tough-love", "personality", "hype", "motivating"):
        assert trait not in lowered, f"persona leaked back in: {trait}"


def test_injuries_are_still_respected() -> None:
    """Constraining the coach must not drop the safety rule that mattered."""
    assert "injur" in PROMPT.lower()


def test_real_pain_still_routes_to_a_professional() -> None:
    lowered = PROMPT.lower()
    assert "professional" in lowered and "medical" in lowered


def test_the_athlete_profile_is_still_injected() -> None:
    """Grounding is what stops invention — it must survive the rewrite."""
    assert "knee rehab" in coach_system_prompt("Alex", "knee rehab", "")


def test_recent_training_is_still_injected() -> None:
    assert "Squat 3x5" in coach_system_prompt("Alex", "", "Squat 3x5")
