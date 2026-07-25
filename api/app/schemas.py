"""Pydantic v2 request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ---------------------------------------------------------------------------
# Auth / user
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    created_at: datetime


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    display_name: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    token: str
    user: UserOut


# ---------------------------------------------------------------------------
# Exercise
# ---------------------------------------------------------------------------
class ExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: Optional[str] = None
    name: str
    category: Optional[str] = None
    force: Optional[str] = None
    level: Optional[str] = None
    mechanic: Optional[str] = None
    equipment: Optional[str] = None
    primary_muscles: list[str] = []
    secondary_muscles: list[str] = []
    instructions: list[str] = []
    images: list[str] = []
    is_custom: bool = False
    owner_id: Optional[int] = None


class ExerciseListOut(BaseModel):
    items: list[ExerciseOut]
    total: int


class ExerciseCreate(BaseModel):
    name: str
    category: Optional[str] = None
    equipment: Optional[str] = None
    force: Optional[str] = None
    level: Optional[str] = None
    mechanic: Optional[str] = None
    primary_muscles: list[str] = []
    secondary_muscles: list[str] = []
    instructions: list[str] = []
    images: list[str] = []


class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    equipment: Optional[str] = None
    force: Optional[str] = None
    level: Optional[str] = None
    mechanic: Optional[str] = None
    primary_muscles: Optional[list[str]] = None
    secondary_muscles: Optional[list[str]] = None
    instructions: Optional[list[str]] = None
    images: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Routine
# ---------------------------------------------------------------------------
class RoutineExerciseIn(BaseModel):
    exercise_id: int
    order: int = 0
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    rest_seconds: Optional[int] = None
    notes: Optional[str] = None


class RoutineExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exercise_id: int
    order: int
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    rest_seconds: Optional[int] = None
    notes: Optional[str] = None
    exercise: Optional[ExerciseOut] = None


class RoutineCreate(BaseModel):
    name: str
    notes: Optional[str] = None
    split_id: Optional[int] = None
    day_label: Optional[str] = None
    day_order: int = 0
    exercises: list[RoutineExerciseIn] = []


class RoutineUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    split_id: Optional[int] = None
    day_label: Optional[str] = None
    day_order: Optional[int] = None
    exercises: Optional[list[RoutineExerciseIn]] = None


class RoutineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: str
    notes: Optional[str] = None
    split_id: Optional[int] = None
    day_label: Optional[str] = None
    day_order: int = 0
    created_at: datetime
    updated_at: datetime
    exercises: list[RoutineExerciseOut] = []


# ---------------------------------------------------------------------------
# Split (weekly plan owning day-routines + schedule + rules)
# ---------------------------------------------------------------------------
class ScheduleEntry(BaseModel):
    day: str
    label: Optional[str] = None
    # Optional link to the routine that fulfils this day (null for rest days).
    routine_id: Optional[int] = None


class SplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: str
    schedule: list[dict[str, Any]] = []
    rules: list[str] = []
    notes: Optional[str] = None
    is_active: bool = False
    created_at: datetime
    updated_at: datetime
    routines: list[RoutineOut] = []


class SplitCreate(BaseModel):
    name: str
    schedule: list[dict[str, Any]] = []
    rules: list[str] = []
    notes: Optional[str] = None


class SplitUpdate(BaseModel):
    name: Optional[str] = None
    schedule: Optional[list[dict[str, Any]]] = None
    rules: Optional[list[str]] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Workout / sets
# ---------------------------------------------------------------------------
class SetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workout_exercise_id: int
    set_number: int
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: str
    completed: bool
    completed_at: Optional[datetime] = None


class SetCreate(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: str = "working"
    completed: bool = True
    set_number: Optional[int] = None


class SetUpdate(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: Optional[str] = None
    completed: Optional[bool] = None
    set_number: Optional[int] = None


class WorkoutExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workout_id: int
    exercise_id: int
    order: int
    notes: Optional[str] = None
    exercise: Optional[ExerciseOut] = None
    sets: list[SetOut] = []


class WorkoutExerciseCreate(BaseModel):
    exercise_id: int
    order: Optional[int] = None


class WorkoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    notes: Optional[str] = None
    source_routine_id: Optional[int] = None
    exercises: list[WorkoutExerciseOut] = []


class WorkoutListOut(BaseModel):
    items: list[WorkoutOut]
    total: int


class WorkoutStart(BaseModel):
    routine_id: Optional[int] = None
    name: Optional[str] = None
    # Backdate a session (logging a workout done on a previous day). Omit for now.
    started_at: Optional[datetime] = None


class WorkoutCreate(BaseModel):
    name: Optional[str] = None
    started_at: Optional[datetime] = None


class WorkoutUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None


# One-shot "log a completed workout after the fact" (no live session).
class LoggedSetIn(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: str = "working"


class LoggedExerciseIn(BaseModel):
    exercise_id: int
    sets: list[LoggedSetIn] = []


class WorkoutLog(BaseModel):
    name: Optional[str] = None
    started_at: Optional[datetime] = None
    notes: Optional[str] = None
    exercises: list[LoggedExerciseIn] = []


# ---------------------------------------------------------------------------
# Body metrics
# ---------------------------------------------------------------------------
class BodyMetricOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    recorded_at: datetime
    weight: Optional[float] = None
    body_fat: Optional[float] = None
    measurements: dict[str, Any] = {}
    notes: Optional[str] = None


class BodyMetricCreate(BaseModel):
    weight: Optional[float] = None
    body_fat: Optional[float] = None
    measurements: dict[str, Any] = {}
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Progress photos
# ---------------------------------------------------------------------------
class ProgressPhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    taken_at: datetime
    notes: Optional[str] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class SettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    units: str
    ai_provider: str
    ai_model: Optional[str] = None
    ollama_url: Optional[str] = None
    ollama_model: Optional[str] = None
    claude_model: Optional[str] = None
    feature_flags: dict[str, Any] = {}
    rest_timer_default: int


class SettingsUpdate(BaseModel):
    units: Optional[str] = None
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = None
    ollama_url: Optional[str] = None
    ollama_model: Optional[str] = None
    claude_api_key: Optional[str] = None  # write-only; never returned in SettingsOut
    claude_model: Optional[str] = None
    feature_flags: Optional[dict[str, Any]] = None
    rest_timer_default: Optional[int] = None


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
class StatsSummary(BaseModel):
    total_workouts: int
    this_week: int
    streak: int = 0  # consecutive days (ending today/yesterday) with a workout
    recent_prs: list[dict[str, Any]] = []
    volume_by_week: list[dict[str, Any]] = []
