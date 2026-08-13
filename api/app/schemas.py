"""Pydantic v2 request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
)

from .progression import cleared_rep_range


# ---------------------------------------------------------------------------
# Auth / user
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    created_at: datetime


# NOTE: `email` is a plain string (not EmailStr) and the password minimum is 1,
# so simple test credentials like "alex" / "1234" work on this LAN-only personal
# instance. Tighten these if the app is ever exposed beyond a trusted network.
class RegisterIn(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
    display_name: str = ""


class LoginIn(BaseModel):
    email: str = Field(min_length=1)
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
    tracking_type: str = "weight_reps"
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
# Workout (plan day — scheduled template owning exercises)
# ---------------------------------------------------------------------------
class WorkoutExerciseIn(BaseModel):
    exercise_id: int
    order: int = 0
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    target_weight_max: Optional[float] = None
    target_duration_seconds: Optional[int] = None
    target_duration_seconds_max: Optional[int] = None
    rest_seconds: Optional[int] = None
    notes: Optional[str] = None


class WorkoutExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exercise_id: int
    order: int
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    target_weight_max: Optional[float] = None
    target_duration_seconds: Optional[int] = None
    target_duration_seconds_max: Optional[int] = None
    rest_seconds: Optional[int] = None
    notes: Optional[str] = None
    exercise: Optional[ExerciseOut] = None


def _validate_weekdays(v: list[int]) -> list[int]:
    if any(d < 0 or d > 6 for d in v):
        raise ValueError("weekdays must be 0..6 (0=Sunday)")
    if len(set(v)) != len(v):
        raise ValueError("weekdays must not repeat")
    return v


class WorkoutCreate(BaseModel):
    name: str
    notes: Optional[str] = None
    split_id: Optional[int] = None
    weekdays: list[int] = []
    floating: bool = False
    order: int = 0
    exercises: list[WorkoutExerciseIn] = []

    @field_validator("weekdays")
    @classmethod
    def _valid_weekdays(cls, v: list[int]) -> list[int]:
        return _validate_weekdays(v)


class WorkoutUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    split_id: Optional[int] = None
    weekdays: Optional[list[int]] = None
    floating: Optional[bool] = None
    order: Optional[int] = None
    exercises: Optional[list[WorkoutExerciseIn]] = None

    @field_validator("weekdays")
    @classmethod
    def _valid_weekdays(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        return v if v is None else _validate_weekdays(v)


class WorkoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: str
    notes: Optional[str] = None
    split_id: Optional[int] = None
    weekdays: list[int] = []
    floating: bool = False
    order: int = 0
    created_at: datetime
    updated_at: datetime
    exercises: list[WorkoutExerciseOut] = []


class TodayWorkout(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    floating: bool
    weekdays: list[int]
    done_this_week: bool
    # Today's weekday claims this day.
    scheduled_today: bool = False
    # Scheduled earlier this week and not done — available as a makeup.
    missed: bool = False


class CatchupWorkout(BaseModel):
    """A plan day the schedule put on this date."""

    id: int
    name: str


class CatchupSession(BaseModel):
    """A bout actually logged on this date."""

    id: int
    name: Optional[str] = None
    exercise_count: int = 0


class CatchupDay(BaseModel):
    """One calendar day of the recent past, in the client's local time."""

    date: str  # YYYY-MM-DD, local to the caller
    weekday: int  # 0=Sun..6=Sat
    scheduled: list[CatchupWorkout] = []
    sessions: list[CatchupSession] = []
    logged: bool = False


# ---------------------------------------------------------------------------
# Split (weekly plan owning workouts + rules)
# ---------------------------------------------------------------------------
class SplitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: str
    rules: list[str] = []
    notes: Optional[str] = None
    is_active: bool = False
    created_at: datetime
    updated_at: datetime
    workouts: list[WorkoutOut] = []


class SplitCreate(BaseModel):
    name: str
    rules: list[str] = []
    notes: Optional[str] = None


class SplitUpdate(BaseModel):
    name: Optional[str] = None
    rules: Optional[list[str]] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Session / sets (a logged bout)
# ---------------------------------------------------------------------------
class SetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_exercise_id: int
    set_number: int
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: str
    duration_seconds: Optional[int] = None
    rest_seconds: Optional[int] = None
    completed: bool
    completed_at: Optional[datetime] = None
    notes: Optional[str] = None


class SetCreate(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: str = "working"
    duration_seconds: Optional[int] = None
    # Seconds rested before this set (see SetEntry.rest_seconds).
    rest_seconds: Optional[int] = None
    completed: bool = True
    set_number: Optional[int] = None
    notes: Optional[str] = None
    # When the set was actually performed. The client sends this so a set
    # logged offline keeps its real time instead of being stamped when it
    # finally syncs. Omitted -> now.
    completed_at: Optional[datetime] = None


class SetUpdate(BaseModel):
    reps: Optional[int] = None
    weight: Optional[float] = None
    rpe: Optional[float] = None
    set_type: Optional[str] = None
    duration_seconds: Optional[int] = None
    rest_seconds: Optional[int] = None
    completed: Optional[bool] = None
    set_number: Optional[int] = None
    notes: Optional[str] = None


class SessionExerciseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    exercise_id: int
    order: int
    notes: Optional[str] = None
    target_sets: Optional[int] = None
    target_reps: Optional[int] = None
    target_reps_max: Optional[int] = None
    target_weight: Optional[float] = None
    target_weight_max: Optional[float] = None
    target_duration_seconds: Optional[int] = None
    target_duration_seconds_max: Optional[int] = None
    exercise: Optional[ExerciseOut] = None
    sets: list[SetOut] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cleared_rep_range(self) -> bool:
        """Did this earn a weight increase next time? Derived, never stored —
        it changes the instant a set is logged, and history keeps the sets."""
        return cleared_rep_range(self.target_sets, self.target_reps_max, self.sets)


class SessionExerciseCreate(BaseModel):
    exercise_id: int
    order: Optional[int] = None


class SessionExerciseUpdate(BaseModel):
    """Swap which movement a logged row is for, keeping its sets."""

    exercise_id: int


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    name: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None
    notes: Optional[str] = None
    source_workout_id: Optional[int] = None
    exercises: list[SessionExerciseOut] = []


class SessionListOut(BaseModel):
    items: list[SessionOut]
    total: int


class SessionStart(BaseModel):
    # FK into a plan Workout the session is started from. The route derives
    # source_workout_id from this.
    workout_id: Optional[int] = None
    name: Optional[str] = None
    # Backdate a session (logging a workout done on a previous day). Omit for now.
    started_at: Optional[datetime] = None


class SessionCreate(BaseModel):
    name: Optional[str] = None
    started_at: Optional[datetime] = None


class SessionUpdate(BaseModel):
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


class SessionLog(BaseModel):
    name: Optional[str] = None
    started_at: Optional[datetime] = None
    notes: Optional[str] = None
    # Links a backfilled session to the plan day it makes up. Without it, a day
    # caught up after the fact stays "missed" on /splits/today forever.
    # int like SessionStart.workout_id, so it lands in the FK column as one.
    source_workout_id: Optional[int] = None
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


class SettingsUpdate(BaseModel):
    units: Optional[str] = None
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = None
    ollama_url: Optional[str] = None
    ollama_model: Optional[str] = None
    claude_api_key: Optional[str] = None  # write-only; never returned in SettingsOut
    claude_model: Optional[str] = None
    feature_flags: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------
class StatsSummary(BaseModel):
    total_workouts: int
    this_week: int
    streak: int = 0  # consecutive days (ending today/yesterday) with a workout
    recent_prs: list[dict[str, Any]] = []
    volume_by_week: list[dict[str, Any]] = []


class ExerciseStats(BaseModel):
    """One exercise's personal records — the PR / min-max line on a workout.

    Every requested id gets a row; one the athlete has never logged comes back
    with null stats and set_count 0 rather than being omitted.
    """

    exercise_id: int
    best_weight: Optional[float] = None
    best_weight_reps: Optional[int] = None
    best_weight_at: Optional[datetime] = None
    min_weight: Optional[float] = None
    max_weight: Optional[float] = None
    max_reps: Optional[int] = None
    set_count: int = 0
    last_performed_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Nutrition (calorie / protein log)
# ---------------------------------------------------------------------------
class NutritionEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    eaten_at: datetime
    label: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[float] = None
    created_at: datetime


class NutritionEntryCreate(BaseModel):
    label: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[float] = None
    # When it was eaten. Omitted -> now, so logging as you go is one step.
    eaten_at: Optional[datetime] = None


class NutritionEntryUpdate(BaseModel):
    """Partial edit. Unset fields are left alone; an explicit null clears."""

    label: Optional[str] = None
    calories: Optional[int] = None
    protein: Optional[float] = None
    eaten_at: Optional[datetime] = None
