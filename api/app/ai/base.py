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


class ParsedSession(BaseModel):
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


# --- Multi-day catch-up (several already-trained days pasted at once) ---


class ParsedDay(BaseModel):
    """One already-trained day lifted out of a multi-day paste.

    ``day`` is the header verbatim ("Thursday", "Jul 30", "Mon - Push"). The
    server deliberately does NOT resolve it to a date: only the client knows
    the device's local calendar, and resolving here would repeat the UTC-day
    bug that timestamps in this app have hit before.
    """

    day: Optional[str] = None
    exercises: list[ParsedExercise] = Field(default_factory=list)


class ParsedDays(BaseModel):
    days: list[ParsedDay] = Field(default_factory=list)


_PARSED_EXERCISE_SCHEMA: dict = PARSE_SCHEMA["properties"]["exercises"]

PARSE_DAYS_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "day": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "exercises": _PARSED_EXERCISE_SCHEMA,
                },
                "required": ["day", "exercises"],
            },
        }
    },
    "required": ["days"],
}


# --- Workout/program import (multi-day plan from a notes app) ---


class ParsedWorkoutExercise(BaseModel):
    exercise: str
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    target_weight_max: Optional[float] = None
    target_duration_seconds: Optional[int] = None
    target_duration_seconds_max: Optional[int] = None
    notes: Optional[str] = None


class ParsedWorkout(BaseModel):
    name: str
    notes: Optional[str] = None
    rest_day: bool = False
    weekdays: list[int] = Field(default_factory=list)
    floating: bool = False
    optional: bool = False
    exercises: list[ParsedWorkoutExercise] = Field(default_factory=list)


class ParsedProgram(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    rules: list[str] = Field(default_factory=list)
    workouts: list[ParsedWorkout] = Field(default_factory=list)


# One exercise's target fields — shared by the program-import schema and the
# single-workout AI-edit schema so the rep-range shape can't drift between them.
_WORKOUT_EXERCISE_ITEM: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "exercise": {"type": "string"},
        "target_sets": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "target_reps": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "target_reps_max": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "target_weight": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "target_weight_max": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "target_duration_seconds": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "target_duration_seconds_max": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
    },
    "required": [
        "exercise",
        "target_sets",
        "target_reps",
        "target_reps_max",
        "target_weight",
        "target_weight_max",
        "target_duration_seconds",
        "target_duration_seconds_max",
        "notes",
    ],
}


PROGRAM_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "name": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "rules": {"type": "array", "items": {"type": "string"}},
        "workouts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                    "rest_day": {"type": "boolean"},
                    "weekdays": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 0, "maximum": 6},
                    },
                    "floating": {"type": "boolean"},
                    "optional": {"type": "boolean"},
                    "exercises": {
                        "type": "array",
                        "items": _WORKOUT_EXERCISE_ITEM,
                    },
                },
                "required": ["name", "notes", "rest_day", "weekdays", "floating", "optional", "exercises"],
            },
        }
    },
    "required": ["name", "notes", "rules", "workouts"],
}


# --- Single-workout conversational edit (AI proposes the updated workout) ---


class EditedWorkout(BaseModel):
    reply: str = ""
    name: str
    notes: Optional[str] = None
    exercises: list[ParsedWorkoutExercise] = Field(default_factory=list)


EDIT_WORKOUT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "reply": {"type": "string"},
        "name": {"type": "string"},
        "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "exercises": {"type": "array", "items": _WORKOUT_EXERCISE_ITEM},
    },
    "required": ["reply", "name", "notes", "exercises"],
}


# --- Split-level conversational edit (name/notes/rules + day scheduling) ---


class EditedSplitDay(BaseModel):
    id: Optional[int] = None  # echoes an existing workout id; null = a new day
    name: str
    weekdays: list[int] = Field(default_factory=list)
    floating: bool = False


class EditedSplit(BaseModel):
    reply: str = ""
    name: str
    notes: Optional[str] = None
    rules: list[str] = Field(default_factory=list)
    days: list[EditedSplitDay] = Field(default_factory=list)


EDIT_SPLIT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "reply": {"type": "string"},
        "name": {"type": "string"},
        "notes": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "rules": {"type": "array", "items": {"type": "string"}},
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "id": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "name": {"type": "string"},
                    "weekdays": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 0, "maximum": 6},
                    },
                    "floating": {"type": "boolean"},
                },
                "required": ["id", "name", "weekdays", "floating"],
            },
        },
    },
    "required": ["reply", "name", "notes", "rules", "days"],
}


# --- Nutrition parsing (a sentence about food -> calories/protein) ---


class ParsedNutritionItem(BaseModel):
    label: str
    calories: Optional[int] = None
    protein: Optional[float] = None


class ParsedNutrition(BaseModel):
    items: list[ParsedNutritionItem] = Field(default_factory=list)


NUTRITION_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "label": {"type": "string"},
                    "calories": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "protein": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                },
                "required": ["label", "calories", "protein"],
            },
        }
    },
    "required": ["items"],
}


# --- Athlete-memory check-in (AI updates the persistent profile) ---


class CheckinResult(BaseModel):
    experience_level: Optional[str] = None
    height: Optional[float] = None
    current_weight: Optional[float] = None
    goal_weight: Optional[float] = None
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
        "height": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "current_weight": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "goal_weight": {"anyOf": [{"type": "number"}, {"type": "null"}]},
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
        "height",
        "current_weight",
        "goal_weight",
        "goals",
        "injuries",
        "equipment",
        "preferences",
        "notes",
        "session_note",
        "acknowledgement",
    ],
}
