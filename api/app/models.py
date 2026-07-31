"""SQLAlchemy ORM models."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    settings: Mapped[Optional["Settings"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    metrics: Mapped[list["BodyMetric"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Settings(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    units: Mapped[str] = mapped_column(String, default="kg")
    ai_provider: Mapped[str] = mapped_column(String, default="ollama")
    ai_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # legacy (unused)
    ollama_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # per-user Ollama server
    ollama_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # per-user
    claude_api_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # per-user, write-only
    claude_model: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # per-user
    feature_flags: Mapped[dict[str, Any]] = mapped_column(
        JSON, default=lambda: {"quick_buttons": True, "in_set_prompts": False}
    )

    user: Mapped["User"] = relationship(back_populates="settings")


class AthleteProfile(Base):
    """Persistent per-user memory the AI reads + writes — the companion's backbone."""

    __tablename__ = "athlete_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    experience_level: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # beginner|intermediate|advanced
    height: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    goal_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    goals: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    injuries: Mapped[list[str]] = mapped_column(JSON, default=list)
    equipment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    preferences: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # cues that land, likes/dislikes
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)        # durable AI-maintained memory
    session_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # transient pre-session check-in
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CoachMessage(Base):
    """Per-user coach conversation history (the coach remembers past chats)."""

    __tablename__ = "coach_message"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String, nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Exercise(Base):
    __tablename__ = "exercise"

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[Optional[str]] = mapped_column(String, index=True, nullable=True)
    name: Mapped[str] = mapped_column(String, index=True, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    force: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    level: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    mechanic: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    equipment: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    primary_muscles: Mapped[list[str]] = mapped_column(JSON, default=list)
    secondary_muscles: Mapped[list[str]] = mapped_column(JSON, default=list)
    instructions: Mapped[list[str]] = mapped_column(JSON, default=list)
    images: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False)
    # How a set of this movement is measured:
    #   weight_reps – external load x reps (default)
    #   bodyweight  – reps only, no load field (chin-ups, push-ups)
    #   time        – a held/timed effort (plank, dead hang)
    tracking_type: Mapped[str] = mapped_column(String, default="weight_reps")
    owner_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Split(Base):
    """A weekly training plan that owns several workouts, plus plan-level
    progression rules."""

    __tablename__ = "split"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Plan-level progression rules: list of short strings.
    rules: Mapped[list[Any]] = mapped_column(JSON, default=list)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship()
    workouts: Mapped[list["Workout"]] = relationship(
        back_populates="split",
        order_by="Workout.order",
    )


class Workout(Base):
    __tablename__ = "workout"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # A workout (day) may belong to a split (weekly plan). Null = standalone.
    split_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("split.id", ondelete="SET NULL"), nullable=True
    )
    # Weekdays this workout is scheduled on: 0=Sun .. 6=Sat. Empty = unscheduled;
    # see `floating` for "do once, any candidate day".
    weekdays: Mapped[list[int]] = mapped_column(JSON, default=list)
    # Floating workouts are not pinned to weekdays (do them whenever).
    floating: Mapped[bool] = mapped_column(Boolean, default=False)
    # Ordering of workouts within the split.
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship()
    split: Mapped[Optional["Split"]] = relationship(back_populates="workouts")
    exercises: Mapped[list["WorkoutExercise"]] = relationship(
        back_populates="workout",
        cascade="all, delete-orphan",
        order_by="WorkoutExercise.order",
    )


class WorkoutExercise(Base):
    __tablename__ = "workout_exercise"

    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(
        ForeignKey("workout.id", ondelete="CASCADE"), nullable=False
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercise.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    target_sets: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_reps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # low end of a range
    target_reps_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # high end; null = fixed reps
    target_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_weight_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_duration_seconds_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    rest_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    workout: Mapped["Workout"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()


class Session(Base):
    __tablename__ = "session"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_workout_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("workout.id", ondelete="SET NULL"), nullable=True
    )

    owner: Mapped["User"] = relationship(back_populates="sessions")
    exercises: Mapped[list["SessionExercise"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionExercise.order",
    )


class SessionExercise(Base):
    __tablename__ = "session_exercise"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("session.id", ondelete="CASCADE"), nullable=False
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercise.id"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Snapshot of the workout's targets taken when the session was started from
    # one, so the logging screen can show what you were aiming for — and history
    # keeps that intent even if the workout changes later.
    target_sets: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_reps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_reps_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_weight_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_duration_seconds_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    session: Mapped["Session"] = relationship(back_populates="exercises")
    exercise: Mapped["Exercise"] = relationship()
    sets: Mapped[list["SetEntry"]] = relationship(
        back_populates="session_exercise",
        cascade="all, delete-orphan",
        order_by="SetEntry.set_number",
    )


class SetEntry(Base):
    __tablename__ = "sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_exercise_id: Mapped[int] = mapped_column(
        ForeignKey("session_exercise.id", ondelete="CASCADE"), nullable=False
    )
    set_number: Mapped[int] = mapped_column(Integer, default=1)
    reps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rpe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    set_type: Mapped[str] = mapped_column(String, default="working")
    # Held/timed efforts record duration instead of reps+weight.
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Rest taken BEFORE this set, in seconds. Recorded on the following set (not
    # the preceding one) so a set logged offline carries it in a single write —
    # a queued set has no server id to PATCH until it syncs.
    rest_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=utcnow)
    # Free-text note on an individual set ("left shoulder tight", "easy", …).
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    session_exercise: Mapped["SessionExercise"] = relationship(back_populates="sets")


class BodyMetric(Base):
    __tablename__ = "body_metric"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    body_fat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    measurements: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    owner: Mapped["User"] = relationship(back_populates="metrics")


class ProgressPhoto(Base):
    __tablename__ = "progress_photo"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The day the photo represents (backdatable); distinct from created_at.
    taken_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Stored filename under uploads_dir/<owner_id>/; never a client path.
    filename: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False, default="image/jpeg")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
