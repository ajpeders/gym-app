"""Logged training sessions, their exercises, and logged sets."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as SASession

from ..db import get_db
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
    SessionCreate,
    SessionExerciseCreate,
    SessionExerciseOut,
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


@router.post("/start", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def start_session(
    payload: SessionStart,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
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


@router.post("/log", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def log_session(
    payload: SessionLog,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
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
        se = SessionExercise(exercise_id=ex.exercise_id, order=i)
        for j, s in enumerate(ex.sets):
            se.sets.append(
                SetEntry(
                    set_number=j + 1,
                    reps=s.reps,
                    weight=s.weight,
                    rpe=s.rpe,
                    set_type=s.set_type,
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
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SessionOut:
    session = _get_session(db, session_id, user)
    session.finished_at = utcnow()
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
