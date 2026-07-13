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


# --- Routine/program import (multi-day plan from a notes app) ---


class ParsedRoutineExercise(BaseModel):
    exercise: str
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    notes: Optional[str] = None


class ParsedRoutine(BaseModel):
    name: str
    notes: Optional[str] = None
    rest_day: bool = False
    exercises: list[ParsedRoutineExercise] = Field(default_factory=list)


class ParsedProgram(BaseModel):
    routines: list[ParsedRoutine] = Field(default_factory=list)


PROGRAM_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "routines": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "rest_day": {"type": "boolean"},
                    "exercises": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "exercise": {"type": "string"},
                                "target_sets": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                                "target_reps": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                                "target_reps_max": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                                "target_weight": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                                "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                            },
                            "required": [
                                "exercise",
                                "target_sets",
                                "target_reps",
                                "target_reps_max",
                                "target_weight",
                                "notes",
                            ],
                        },
                    },
                },
                "required": ["name", "notes", "rest_day", "exercises"],
            },
        }
    },
    "required": ["routines"],
}


# --- Athlete-memory check-in (AI updates the persistent profile) ---


class CheckinResult(BaseModel):
    experience_level: Optional[str] = None
    goals: Optional[str] = None
    injuries: list[str] = Field(default_factory=list)
    equipment: Optional[str] = None
    preferences: Optional[str] = None
    notes: Optional[str] = None
    session_note: Optional[str] = None
    acknowledgement: str = ""


CHECKIN_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "experience_level": {
            "anyOf": [
                {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
                {"type": "null"},
            ]
        },
        "goals": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "injuries": {"type": "array", "items": {"type": "string"}},
        "equipment": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "preferences": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "session_note": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "acknowledgement": {"type": "string"},
    },
    "required": [
        "experience_level",
        "goals",
        "injuries",
        "equipment",
        "preferences",
        "notes",
        "session_note",
        "acknowledgement",
    ],
}


class Provider(Protocol):
    name: str
    model: str

    async def complete_json(self, *, system: str, user: str, schema: dict) -> dict:
        ...

    async def complete_text(self, *, system: str, messages: list[dict]) -> str:
        ...
