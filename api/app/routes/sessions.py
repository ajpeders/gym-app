"""Logged training sessions, their exercises, and logged sets."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as SASession

from .. import csv_io
from ..db import get_db
from ..ai import service as ai_service
from ..ai.base import AIError
from ..ai.service import UnmatchedExercises, match_exercise
from ..idempotency import idempotency_key, replay_or_run
from ..models import (
    Exercise,
    Session,
    SessionExercise,
    SetEntry,
    User,
    Workout,
    utcnow,
)
from ..schemas import (
    LoggedExerciseIn,
    LoggedSetIn,
    SessionCreate,
    SessionExerciseCreate,
    SessionExerciseOut,
    SessionExerciseUpdate,
    SessionFinish,
    SessionListOut,
    SessionLog,
    SessionOut,
    SessionStart,
    SessionUpdate,
    SetCreate,
    SetOut,
    SetUpdate,
)
from ..security import get_current_user

router = APIRouter(prefix="/sessions", tags=["sessions"])


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _get_session(db: SASession, session_id: int, user: User) -> Session:
    s = db.scalar(
        select(Session).where(Session.id == session_id, Session.owner_id == user.id)
    )
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return s


def _get_session_exercise(
    db: SASession, session: Session, se_id: int
) -> SessionExercise:
    se = db.get(SessionExercise, se_id)
    if se is None or se.session_id != session.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session exercise not found"
        )
    return se


def _validate_exercise(db: SASession, exercise_id: int, user: User) -> Exercise:
    ex = db.get(Exercise, exercise_id)
    if ex is None or (ex.owner_id is not None and ex.owner_id != user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid exercise_id {exercise_id}",
        )
    return ex


# --------------------------------------------------------------------------
# Session lifecycle
# --------------------------------------------------------------------------
@router.get("", response_model=SessionListOut)
def list_sessions(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionListOut:
    base = select(Session).where(Session.owner_id == user.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(Session.started_at.desc()).offset(offset).limit(limit)
    ).all()
    return SessionListOut(
        items=[SessionOut.model_validate(s) for s in rows], total=total
    )


def _resolve_started_at(value: datetime | None) -> datetime:
    """A caller-supplied date backdates the session; naive input is treated as
    UTC to match utcnow(). Omitted -> now."""
    if value is None:
        return utcnow()
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _close_open_sessions(db: SASession, user: User) -> None:
    """Finish any session still in progress — at most one may be live.

    Every start path used to create a session unconditionally, so a stray tap
    left the previous one open forever. Enforced here rather than in the client
    because there are several start paths and the device only remembers the
    newest session id.

    Finished, never deleted: the offline set queue drops a set permanently on a
    4xx, so removing a session another device is still syncing to would lose
    that work. An empty leftover is clutter; a lost set is data.
    """
    for stale in db.scalars(
        select(Session).where(Session.owner_id == user.id, Session.finished_at.is_(None))
    ).all():
        # Its own last set is a truer end than "now" for a session abandoned days ago.
        last_set = db.scalar(
            select(func.max(SetEntry.completed_at))
            .join(SessionExercise, SessionExercise.id == SetEntry.session_exercise_id)
            .where(SessionExercise.session_id == stale.id)
        )
        stale.finished_at = last_set or stale.started_at


@router.get("/active", response_model=Optional[SessionOut])
def active_session(
    db: SASession = Depends(get_db), user: User = Depends(get_current_user)
) -> Optional[SessionOut]:
    """The session in progress, or null. Lets a client find one it doesn't
    remember — localStorage only ever holds the newest id."""
    row = db.scalar(
        select(Session)
        .where(Session.owner_id == user.id, Session.finished_at.is_(None))
        .order_by(Session.started_at.desc())
    )
    return SessionOut.model_validate(row) if row else None


@router.post("/start", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def start_session(
    payload: SessionStart,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
    key: str | None = Depends(idempotency_key),
) -> SessionOut:
    return replay_or_run(
        db, user, key, lambda: _start_session(payload, db, user), lambda o: o.model_dump()
    )


def _start_session(payload: SessionStart, db: SASession, user: User) -> SessionOut:
    _close_open_sessions(db, user)
    session = Session(
        owner_id=user.id,
        name=payload.name,
        started_at=_resolve_started_at(payload.started_at),
        finished_at=None,
        source_workout_id=payload.workout_id,
    )
    if payload.workout_id is not None:
        workout = db.scalar(
            select(Workout).where(
                Workout.id == payload.workout_id, Workout.owner_id == user.id
            )
        )
        if workout is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Workout not found"
            )
        if not session.name:
            session.name = workout.name
        for we in workout.exercises:
            session.exercises.append(
                SessionExercise(
                    exercise_id=we.exercise_id,
                    order=we.order,
                    notes=we.notes,
                    target_sets=we.target_sets,
                    target_reps=we.target_reps,
                    target_reps_max=we.target_reps_max,
                    target_weight=we.target_weight,
                    target_weight_max=we.target_weight_max,
                    target_duration_seconds=we.target_duration_seconds,
                    target_duration_seconds_max=we.target_duration_seconds_max,
                    # Pairing is part of the plan's intent, so it's snapshotted
                    # with the rest of it.
                    superset_group=we.superset_group,
                )
            )
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionOut.model_validate(session)


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    session = Session(
        owner_id=user.id, name=payload.name, started_at=_resolve_started_at(payload.started_at)
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionOut.model_validate(session)


class SessionLogText(BaseModel):
    """A phrase to log, e.g. "bench 3x8 @60, then 3x12 lateral raises 10"."""

    text: str = Field(min_length=1)
    name: Optional[str] = None
    started_at: Optional[str] = None


@router.post("/log-text", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def log_session_from_text(
    payload: SessionLogText,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
    key: str | None = Depends(idempotency_key),
) -> SessionOut:
    """Log a session from plain text, resolving exercises deterministically.

    The spotter uses this instead of building a /log payload itself. Every
    exercise id here comes from the catalog matcher, and NxM is expanded by the
    parser — both of which a small model gets wrong (it sent one set and
    exercise_id 1, "Step Jack", for "3x5 squats").
    """
    try:
        parsed = await ai_service.log_text(
            db, user, payload.text, name=payload.name, started_at=payload.started_at
        )
    except UnmatchedExercises as exc:
        # 422, not 400: the phrase was understood, the movement just isn't in
        # the catalog. The spotter is told to report the names, never substitute.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except AIError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return replay_or_run(
        db, user, key, lambda: _log_session(parsed, db, user), lambda o: o.model_dump()
    )


class CsvImport(BaseModel):
    """A whole training history, pasted or uploaded as CSV."""

    csv: str


class CsvImportResult(BaseModel):
    format: str
    sessions_created: int
    sets_imported: int
    # Movements the catalog couldn't place. Reported, never dropped silently:
    # a history missing its main lift is not the history.
    unmatched: list[str] = []


@router.post("/import-csv", response_model=CsvImportResult, status_code=status.HTTP_201_CREATED)
def import_csv(
    payload: CsvImport,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CsvImportResult:
    """Import a Hevy or Strong export.

    The format is sniffed from the header row and both are normalised to one
    shape (`app/csv_io.py`). No model is involved — a CSV is structured data,
    and reading it with an LLM would be slower, costlier and less reliable.
    Exercises resolve through the same catalog matcher as every other import.
    """
    fmt = csv_io.detect_format(payload.csv)
    if fmt is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "That doesn't look like a Hevy or Strong export — the header row "
                "should name the exercise column."
            ),
        )

    sessions = csv_io.sessions_from_rows(csv_io.parse_rows(payload.csv))
    unmatched: list[str] = []
    created = 0
    imported_sets = 0

    for raw in sessions:
        exercises: list[LoggedExerciseIn] = []
        for item in raw["exercises"]:
            exercise_id, _ = match_exercise(db, user.id, item["exercise"])
            if exercise_id is None:
                if item["exercise"] not in unmatched:
                    unmatched.append(item["exercise"])
                continue
            exercises.append(
                LoggedExerciseIn(
                    exercise_id=exercise_id,
                    notes=item.get("notes"),
                    sets=[LoggedSetIn(**s) for s in item["sets"]],
                )
            )
            imported_sets += len(item["sets"])
        if not exercises:
            continue
        _log_session(
            SessionLog(
                name=raw["name"],
                started_at=_parse_csv_datetime(raw["started_at"]),
                exercises=exercises,
            ),
            db,
            user,
        )
        created += 1

    return CsvImportResult(
        format=fmt, sessions_created=created, sets_imported=imported_sets, unmatched=unmatched
    )


@router.get("/export.csv")
def export_csv(
    db: SASession = Depends(get_db), user: User = Depends(get_current_user)
) -> Response:
    """Every logged set, in a CSV this app can read back in.

    Deliberately the same shape `import-csv` accepts: an export you can't
    re-import is a screenshot with extra steps.
    """
    rows = db.scalars(
        select(Session)
        .where(Session.owner_id == user.id)
        .order_by(Session.started_at)
    ).all()

    payload = [
        {
            "name": s.name or "",
            "started_at": s.started_at.isoformat(sep=" ", timespec="seconds"),
            "exercises": [
                {
                    "exercise": (se.exercise.name if se.exercise else "Exercise"),
                    "sets": [
                        {
                            "reps": st.reps,
                            "weight": st.weight,
                            "rpe": st.rpe,
                            "duration_seconds": st.duration_seconds,
                            "set_type": st.set_type,
                            "notes": st.notes,
                        }
                        for st in se.sets
                    ],
                }
                for se in s.exercises
            ],
        }
        for s in rows
    ]
    return Response(
        content=csv_io.sessions_to_csv(payload),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="gym-app-history.csv"'},
    )


def _parse_csv_datetime(value: str) -> datetime | None:
    """Both exporters write "YYYY-MM-DD HH:MM:SS"; some locales write ISO."""
    text = (value or "").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


@router.post("/log", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def log_session(
    payload: SessionLog,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    return _log_session(payload, db, user)


def _log_session(payload: SessionLog, db: SASession, user: User) -> SessionOut:
    """Log a whole completed session in one shot (no live session) — for
    recording a session you already did. Created already-finished at the given
    date, with all exercises and their sets, atomically."""
    started = _resolve_started_at(payload.started_at)
    if payload.source_workout_id is not None:
        owned = db.scalar(
            select(Workout).where(
                Workout.id == payload.source_workout_id, Workout.owner_id == user.id
            )
        )
        if owned is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Workout not found"
            )
    session = Session(
        owner_id=user.id,
        name=payload.name,
        started_at=started,
        finished_at=started,  # already done → completed
        notes=payload.notes,
        source_workout_id=payload.source_workout_id,
    )
    for i, ex in enumerate(payload.exercises):
        _validate_exercise(db, ex.exercise_id, user)
        se = SessionExercise(exercise_id=ex.exercise_id, order=i, notes=ex.notes)
        for j, s in enumerate(ex.sets):
            se.sets.append(
                SetEntry(
                    set_number=j + 1,
                    reps=s.reps,
                    weight=s.weight,
                    rpe=s.rpe,
                    set_type=s.set_type,
                    duration_seconds=s.duration_seconds,
                    notes=s.notes,
                    completed=True,
                    completed_at=started,
                )
            )
        session.exercises.append(se)
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionOut.model_validate(session)


@router.get("/{session_id}", response_model=SessionOut)
def get_session(
    session_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    return SessionOut.model_validate(_get_session(db, session_id, user))


@router.patch("/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int,
    payload: SessionUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    session = _get_session(db, session_id, user)
    if payload.name is not None:
        session.name = payload.name
    if payload.notes is not None:
        session.notes = payload.notes
    db.commit()
    db.refresh(session)
    return SessionOut.model_validate(session)


@router.post("/{session_id}/finish", response_model=SessionOut)
def finish_session(
    session_id: int,
    payload: SessionFinish | None = None,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    """Close a session. Naturally idempotent: an already-finished session keeps
    the end time it has, because a finish queued offline can arrive hours later
    (or after the single-active-session guard already closed it) and must not
    restamp the workout with the moment the phone found signal."""
    session = _get_session(db, session_id, user)
    if session.finished_at is None:
        session.finished_at = _resolve_started_at(
            payload.finished_at if payload else None
        )
    db.commit()
    db.refresh(session)
    return SessionOut.model_validate(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.delete(_get_session(db, session_id, user))
    db.commit()


# --------------------------------------------------------------------------
# Session exercises
# --------------------------------------------------------------------------
@router.post(
    "/{session_id}/exercises",
    response_model=SessionExerciseOut,
    status_code=status.HTTP_201_CREATED,
)
def add_session_exercise(
    session_id: int,
    payload: SessionExerciseCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
    key: str | None = Depends(idempotency_key),
) -> SessionExerciseOut:
    return replay_or_run(
        db,
        user,
        key,
        lambda: _add_session_exercise(session_id, payload, db, user),
        lambda o: o.model_dump(),
    )


def _add_session_exercise(
    session_id: int, payload: SessionExerciseCreate, db: SASession, user: User
) -> SessionExerciseOut:
    session = _get_session(db, session_id, user)
    _validate_exercise(db, payload.exercise_id, user)
    order = payload.order
    if order is None:
        order = (
            db.scalar(
                select(func.coalesce(func.max(SessionExercise.order), -1)).where(
                    SessionExercise.session_id == session.id
                )
            )
            + 1
        )
    se = SessionExercise(
        session_id=session.id, exercise_id=payload.exercise_id, order=order
    )
    db.add(se)
    db.commit()
    db.refresh(se)
    return SessionExerciseOut.model_validate(se)


@router.patch(
    "/{session_id}/exercises/{se_id}", response_model=SessionExerciseOut
)
def swap_session_exercise(
    session_id: int,
    se_id: int,
    payload: SessionExerciseUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionExerciseOut:
    """Point a logged row at a different movement, keeping its sets.

    The everyday case is a machine being occupied: the work happened, just on
    another exercise. Deleting and re-adding was the only way before, and it
    discarded the sets. Order and snapshotted targets stay put — the row keeps
    its place in the session and what it was standing in for.
    """
    session = _get_session(db, session_id, user)
    se = _get_session_exercise(db, session, se_id)
    _validate_exercise(db, payload.exercise_id, user)
    se.exercise_id = payload.exercise_id
    db.commit()
    db.refresh(se)
    return SessionExerciseOut.model_validate(se)


@router.delete(
    "/{session_id}/exercises/{se_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_session_exercise(
    session_id: int,
    se_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    session = _get_session(db, session_id, user)
    se = _get_session_exercise(db, session, se_id)
    db.delete(se)
    db.commit()


# --------------------------------------------------------------------------
# Sets
# --------------------------------------------------------------------------
@router.post(
    "/{session_id}/exercises/{se_id}/sets",
    response_model=SetOut,
    status_code=status.HTTP_201_CREATED,
)
def add_set(
    session_id: int,
    se_id: int,
    payload: SetCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
    key: str | None = Depends(idempotency_key),
) -> SetOut:
    return replay_or_run(
        db,
        user,
        key,
        lambda: _add_set(session_id, se_id, payload, db, user),
        lambda o: o.model_dump(),
    )


def _add_set(
    session_id: int, se_id: int, payload: SetCreate, db: SASession, user: User
) -> SetOut:
    session = _get_session(db, session_id, user)
    se = _get_session_exercise(db, session, se_id)
    set_number = payload.set_number
    if set_number is None:
        set_number = (
            db.scalar(
                select(func.coalesce(func.max(SetEntry.set_number), 0)).where(
                    SetEntry.session_exercise_id == se.id
                )
            )
            + 1
        )
    entry = SetEntry(
        session_exercise_id=se.id,
        set_number=set_number,
        reps=payload.reps,
        weight=payload.weight,
        rpe=payload.rpe,
        set_type=payload.set_type,
        duration_seconds=payload.duration_seconds,
        rest_seconds=payload.rest_seconds,
        completed=payload.completed,
        completed_at=(
            _resolve_started_at(payload.completed_at)
            if payload.completed_at is not None
            else (utcnow() if payload.completed else None)
        ),
        notes=payload.notes,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return SetOut.model_validate(entry)


def _get_set(db: SASession, session: Session, se_id: int, set_id: int) -> SetEntry:
    se = _get_session_exercise(db, session, se_id)
    entry = db.get(SetEntry, set_id)
    if entry is None or entry.session_exercise_id != se.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Set not found")
    return entry


@router.patch(
    "/{session_id}/exercises/{se_id}/sets/{set_id}", response_model=SetOut
)
def update_set(
    session_id: int,
    se_id: int,
    set_id: int,
    payload: SetUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SetOut:
    session = _get_session(db, session_id, user)
    entry = _get_set(db, session, se_id, set_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(entry, field, value)
    if "completed" in data:
        entry.completed_at = utcnow() if entry.completed else None
    db.commit()
    db.refresh(entry)
    return SetOut.model_validate(entry)


@router.delete(
    "/{session_id}/exercises/{se_id}/sets/{set_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_set(
    session_id: int,
    se_id: int,
    set_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    session = _get_session(db, session_id, user)
    entry = _get_set(db, session, se_id, set_id)
    db.delete(entry)
    db.commit()
