"""Gym's AI domain: parse/check-in schemas + result models.

The provider layer itself (Provider protocol, Ollama/Claude impls) moved out to
the reusable `companion` package — this module keeps only what is gym-specific.
`AIError` is companion's ProviderError under gym's historical name, so route
handlers catch domain and provider failures alike.
"""
from __future__ import annotations

from typing import Literal, Optional

from companion import ProviderError
from pydantic import BaseModel, Field

AIError = ProviderError

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


# One exercise's target fields — shared by the program-import schema and the
# single-routine AI-edit schema so the rep-range shape can't drift between them.
_ROUTINE_EXERCISE_ITEM: dict = {
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
}


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
                        "items": _ROUTINE_EXERCISE_ITEM,
                    },
                },
                "required": ["name", "notes", "rest_day", "exercises"],
            },
        }
    },
    "required": ["routines"],
}


# --- Single-routine conversational edit (AI proposes the updated routine) ---


class EditedRoutine(BaseModel):
    reply: str = ""
    name: str
    notes: Optional[str] = None
    exercises: list[ParsedRoutineExercise] = Field(default_factory=list)


EDIT_ROUTINE_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "reply": {"type": "string"},
        "name": {"type": "string"},
        "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "exercises": {"type": "array", "items": _ROUTINE_EXERCISE_ITEM},
    },
    "required": ["reply", "name", "notes", "exercises"],
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
