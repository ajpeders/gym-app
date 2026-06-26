"""Shared types + JSON schema for the AI provider layer."""
from __future__ import annotations

from typing import Literal, Optional, Protocol

from pydantic import BaseModel, Field

SetType = Literal["warmup", "working", "drop", "failure"]


class ParsedSet(BaseModel):
    reps: int = 0
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: SetType = "working"


class ParsedExercise(BaseModel):
    exercise: str
    sets: list[ParsedSet] = Field(default_factory=list)
    notes: Optional[str] = None


class ParsedWorkout(BaseModel):
    exercises: list[ParsedExercise] = Field(default_factory=list)


class AIError(Exception):
    """Raised when a provider request fails or returns unusable output."""


# JSON schema handed to the model. Shape is shared by Ollama's `format` field
# and Claude's `output_config.format` (strict structured outputs), so every
# object lists all properties in `required` and disables additionalProperties.
PARSE_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "exercises": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "exercise": {"type": "string"},
                    "sets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "reps": {"type": "integer"},
                                "weight": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                                "rpe": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                                "set_type": {
                                    "type": "string",
                                    "enum": ["warmup", "working", "drop", "failure"],
                                },
                            },
                            "required": ["reps", "weight", "rpe", "set_type"],
                        },
                    },
                    "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                },
                "required": ["exercise", "sets", "notes"],
            },
        }
    },
    "required": ["exercises"],
}


class Provider(Protocol):
    name: str
    model: str

    async def parse(self, *, text: str, units: str, hint_names: list[str]) -> ParsedWorkout:
        ...
