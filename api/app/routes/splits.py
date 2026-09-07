"""Split (weekly plan) CRUD — a plan owns several day-workouts + rules."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session as SASession

from ..db import get_db
from ..idempotency import idempotency_key, replay_or_run
from ..models import Exercise, Session, Split, User, Workout, WorkoutExercise
from ..rotation import done_this_cycle, up_next
from .. import presets as preset_library
from ..ai.service import match_exercise
from ..schemas import (
    AdoptedPreset,
    CatchupDay,
    CatchupSession,
    CatchupWorkout,
    SplitCreate,
    PresetSplit,
    SplitImportIn,
    SplitImportOut,
    SplitImportWorkout,
    SplitOut,
    SplitUpdate,
    TodayWorkout,
)
from ..security import get_current_user

router = APIRouter(prefix="/splits", tags=["splits"])


def _get_owned(db: SASession, split_id: int, user: User) -> Split:
    split = db.scalar(select(Split).where(Split.id == split_id, Split.owner_id == user.id))
    if split is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Split not found")
    return split


@router.get("", response_model=list[SplitOut])
def list_splits(
    db: SASession = Depends(get_db), user: User = Depends(get_current_user)
) -> list[SplitOut]:
    rows = db.scalars(
        select(Split)
        .where(Split.owner_id == user.id)
        .order_by(Split.is_active.desc(), Split.created_at.desc())
    ).all()
    return [SplitOut.model_validate(s) for s in rows]


@router.post("", response_model=SplitOut, status_code=status.HTTP_201_CREATED)
def create_split(
    payload: SplitCreate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SplitOut:
    split = Split(
        owner_id=user.id,
        name=payload.name,
        mode=payload.mode,
        rules=payload.rules,
        notes=payload.notes,
    )
    db.add(split)
    db.commit()
    db.refresh(split)
    return SplitOut.model_validate(split)


# --- import ----------------------------------------------------------------


def _norm(name: str) -> str:
    return " ".join(name.split()).strip().lower()


def _resolve_exercise_ids(
    db: SASession, payload: SplitImportIn, user: User
) -> tuple[dict[str, int], int, int]:
    """Map every unmatched movement name to an exercise id, creating what's missing.

    Reuses one of the user's own custom exercises when the name already exists
    rather than minting a near-duplicate on every re-import — the thing that
    made importing the same plan twice leave two "Cable Face Pull"s behind.
    The shared catalog is never written to; an unmatched movement always
    becomes something *you* own.
    """
    wanted = {
        _norm(ex.custom_name or ""): (ex.custom_name or "").strip()
        for w in payload.workouts
        for ex in w.exercises
        if ex.exercise_id is None
    }
    if not wanted:
        return {}, 0, 0

    existing = {
        _norm(row.name): row.id
        for row in db.scalars(
            select(Exercise).where(Exercise.owner_id == user.id)
        ).all()
    }
    resolved: dict[str, int] = {}
    created = reused = 0
    for key, display in wanted.items():
        found = existing.get(key)
        if found is not None:
            resolved[key] = found
            reused += 1
            continue
        row = Exercise(name=display, is_custom=True, owner_id=user.id)
        db.add(row)
        db.flush()  # need the id inside this transaction
        resolved[key] = row.id
        existing[key] = row.id
        created += 1
    return resolved, created, reused


def _validate_catalog_ids(db: SASession, payload: SplitImportIn, user: User) -> None:
    ids = {ex.exercise_id for w in payload.workouts for ex in w.exercises if ex.exercise_id}
    if not ids:
        return
    visible = {
        row.id
        for row in db.scalars(
            select(Exercise).where(
                Exercise.id.in_(ids),
                or_(Exercise.owner_id.is_(None), Exercise.owner_id == user.id),
            )
        ).all()
    }
    missing = sorted(ids - visible)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown exercise_id {missing[0]}",
        )


def _build_rows(
    src: SplitImportWorkout, custom_ids: dict[str, int]
) -> list[WorkoutExercise]:
    rows = []
    for order, ex in enumerate(src.exercises):
        exercise_id = ex.exercise_id or custom_ids[_norm(ex.custom_name or "")]
        rows.append(
            WorkoutExercise(
                exercise_id=exercise_id,
                order=order,
                target_sets=ex.target_sets,
                target_reps=ex.target_reps,
                target_reps_max=ex.target_reps_max,
                target_weight=ex.target_weight,
                target_weight_max=ex.target_weight_max,
                target_duration_seconds=ex.target_duration_seconds,
                target_duration_seconds_max=ex.target_duration_seconds_max,
                rest_seconds=ex.rest_seconds,
                notes=ex.notes,
            )
        )
    return rows


def _do_import(payload: SplitImportIn, db: SASession, user: User) -> SplitImportOut:
    _validate_catalog_ids(db, payload, user)
    custom_ids, created_exercises, reused_exercises = _resolve_exercise_ids(db, payload, user)

    if payload.replace_split_id is not None:
        split = _get_owned(db, payload.replace_split_id, user)
        split.name = payload.name
        split.mode = payload.mode
        split.rules = payload.rules
        split.notes = payload.notes
    else:
        split = Split(
            owner_id=user.id,
            name=payload.name,
            mode=payload.mode,
            rules=payload.rules,
            notes=payload.notes,
        )
        db.add(split)
        db.flush()

    # Match days by name so a re-import updates the workout in place. Its id is
    # what logged sessions point at (`source_workout_id`) and what the rotation
    # counts, so replacing the row would quietly detach a plan from its history.
    by_name: dict[str, Workout] = {}
    for existing in list(split.workouts):
        by_name.setdefault(_norm(existing.name), existing)

    created = updated = 0
    kept: set[int] = set()
    for order, src in enumerate(payload.workouts):
        row = by_name.get(_norm(src.name))
        if row is None:
            row = Workout(owner_id=user.id, split_id=split.id, name=src.name)
            db.add(row)
            created += 1
        else:
            updated += 1
        row.name = src.name
        row.notes = src.notes
        row.weekdays = [] if src.floating else src.weekdays
        row.floating = src.floating
        row.order = order
        row.exercises = _build_rows(src, custom_ids)
        db.flush()
        kept.add(row.id)

    removed = 0
    for existing in list(split.workouts):
        if existing.id in kept:
            continue
        # The plan no longer has this day. Detach any logged session first:
        # SQLite doesn't enforce the ON DELETE SET NULL unless foreign keys are
        # switched on, and a dangling source_workout_id would let the rotation
        # count a day that no longer exists.
        db.execute(
            update(Session)
            .where(Session.owner_id == user.id, Session.source_workout_id == existing.id)
            .values(source_workout_id=None)
        )
        db.delete(existing)
        removed += 1

    if payload.make_active:
        db.execute(
            update(Split)
            .where(Split.owner_id == user.id, Split.id != split.id)
            .values(is_active=False)
        )
        split.is_active = True

    db.commit()
    db.refresh(split)
    return SplitImportOut(
        split=SplitOut.model_validate(split),
        created_workouts=created,
        updated_workouts=updated,
        removed_workouts=removed,
        created_exercises=created_exercises,
        reused_exercises=reused_exercises,
    )


@router.post("/import", response_model=SplitImportOut, status_code=status.HTTP_201_CREATED)
def import_split(
    payload: SplitImportIn,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
    key: str | None = Depends(idempotency_key),
) -> SplitImportOut:
    """Apply a reviewed plan in one transaction.

    All of it or none of it, so "saving failed, try again" can't leave a
    half-built split behind — and with an `Idempotency-Key`, the retry after a
    response that never arrived returns the first answer instead of importing
    the same plan a second time.
    """
    return replay_or_run(
        db, user, key, lambda: _do_import(payload, db, user), lambda o: o.model_dump()
    )


def _week_start(now: datetime) -> datetime:
    # Sunday 00:00 UTC (sessions store started_at in UTC; no per-user tz tracked).
    days_since_sun = (now.weekday() + 1) % 7
    return (now - timedelta(days=days_since_sun)).replace(hour=0, minute=0, second=0, microsecond=0)


def _done_this_week(db: SASession, user_id: int, workout_id: int, now: datetime) -> bool:
    return db.scalar(select(Session.id).where(
        Session.owner_id == user_id,
        Session.source_workout_id == workout_id,
        Session.started_at >= _week_start(now),
    ).limit(1)) is not None


def _rotation_history(
    db: SASession, user_id: int, rotation: list[int], before: datetime | None = None
) -> list[int]:
    """Workout ids of this split's recent sessions, most recent first.

    Only the current pass matters (see app/rotation.py), so this stops well
    short of the full history — one more than a full lap is enough to see where
    the pass began.
    """
    if not rotation:
        return []
    q = select(Session.source_workout_id).where(
        Session.owner_id == user_id,
        Session.source_workout_id.in_(rotation),
    )
    if before is not None:
        q = q.where(Session.started_at < before)
    return list(
        db.scalars(
            q.order_by(Session.started_at.desc(), Session.id.desc()).limit(len(rotation) + 1)
        ).all()
    )


def _today_rolling(db: SASession, user: User, active: Split) -> list[TodayWorkout]:
    """A rolling split's answer to "what now": the whole rotation, with the
    next day flagged. Nothing is scheduled or missed — there are no dates to be
    late against — so every day stays available and the cycle, not the
    calendar, says which one is up."""
    rotation = [w.id for w in active.workouts]
    history = _rotation_history(db, user.id, rotation)
    nxt = up_next(rotation, history)
    done = done_this_cycle(rotation, history)
    now = datetime.now(timezone.utc)
    return [
        TodayWorkout(
            id=w.id,
            name=w.name,
            floating=w.floating,
            weekdays=w.weekdays or [],
            done_this_week=_done_this_week(db, user.id, w.id, now),
            up_next=w.id == nxt,
            done_this_cycle=w.id in done,
        )
        for w in active.workouts
    ]


@router.get("/today", response_model=list[TodayWorkout])
def today(db: SASession = Depends(get_db), user: User = Depends(get_current_user)):
    """What the athlete could train right now, from the active split.

    Returns three kinds of day, distinguished by flags rather than by being
    filtered out, so a rest day still has something to offer:

    * ``scheduled_today`` — today's weekday claims it.
    * ``missed`` — scheduled earlier this week and not yet done: a makeup.
    * floating — pinned to no weekday, so always available. These used to be
      dropped entirely, since a floating day has empty ``weekdays`` and the
      old filter asked whether today was in that empty list.

    Days still upcoming later this week are omitted — they aren't due yet.

    All of that is the *rigid* reading, where the calendar schedules the plan.
    A rolling split has no weekdays to read, so it takes a different path
    entirely — see `_today_rolling`.
    """
    now = datetime.now(timezone.utc)
    weekday = (now.weekday() + 1) % 7  # 0=Sun..6=Sat
    active = db.scalar(select(Split).where(Split.owner_id == user.id, Split.is_active.is_(True)))
    if active is None:
        return []
    if active.mode == "rolling":
        return _today_rolling(db, user, active)

    rows: list[TodayWorkout] = []
    for w in active.workouts:
        weekdays = w.weekdays or []
        scheduled_today = weekday in weekdays
        done = _done_this_week(db, user.id, w.id, now)
        # Earlier this week and never done — offer it as a makeup. "Earlier"
        # means every weekday it claims has already passed, so a day pinned to
        # both Friday and Saturday isn't missed until Saturday is behind us.
        missed = (
            not scheduled_today
            and not w.floating
            and bool(weekdays)
            and max(weekdays) < weekday
            and not done
        )
        if not (scheduled_today or missed or w.floating):
            continue
        rows.append(
            TodayWorkout(
                id=w.id,
                name=w.name,
                floating=w.floating,
                weekdays=weekdays,
                done_this_week=done,
                scheduled_today=scheduled_today,
                missed=missed,
            )
        )
    return rows


@router.get("/catchup", response_model=list[CatchupDay])
def catchup(
    days: int = 14,
    tz_offset: int = 0,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CatchupDay]:
    """The recent past day by day, so an unlogged backlog is visible.

    ``/today`` answers "what now"; this answers "what did I miss". Each day
    carries what the active split scheduled for that weekday and any sessions
    actually logged, most recent first.

    ``tz_offset`` follows JS ``getTimezoneOffset()`` — minutes to ADD to local
    time to reach UTC (UTC-6 sends 360). Sessions are stored naive UTC, so
    bucketing them by UTC date would file an evening session under the next
    day for anyone west of UTC.
    """
    days = max(1, min(days, 60))
    shift = timedelta(minutes=tz_offset)
    now_local = datetime.now(timezone.utc).replace(tzinfo=None) - shift
    today_local = now_local.date()
    oldest_local = today_local - timedelta(days=days - 1)

    # Widen the fetch by a day on each side: a local day straddles two UTC ones.
    rows = db.scalars(
        select(Session)
        .where(
            Session.owner_id == user.id,
            Session.started_at >= datetime.combine(oldest_local, datetime.min.time()) + shift - timedelta(days=1),
            Session.started_at < datetime.combine(today_local, datetime.min.time()) + shift + timedelta(days=2),
        )
        .order_by(Session.started_at)
    ).all()

    by_date: dict[str, list[CatchupSession]] = {}
    for s in rows:
        local_day = (s.started_at - shift).date().isoformat()
        by_date.setdefault(local_day, []).append(
            CatchupSession(id=s.id, name=s.name, exercise_count=len(s.exercises))
        )

    active = db.scalar(select(Split).where(Split.owner_id == user.id, Split.is_active.is_(True)))
    rolling = active is not None and active.mode == "rolling"
    scheduled_by_weekday: dict[int, list[CatchupWorkout]] = {}
    if active is not None and not rolling:
        for w in active.workouts:
            for wd in w.weekdays or []:
                scheduled_by_weekday.setdefault(wd, []).append(
                    CatchupWorkout(id=w.id, name=w.name)
                )

    # A rolling split schedules nothing by weekday, so reading `weekdays` here
    # leaves the column permanently empty and gap detection has nothing to
    # compare against. What a rolling day was "for" is wherever the rotation
    # had got to by then, so replay the cycle forward through the window.
    rotation: list[int] = []
    by_workout: dict[int, CatchupWorkout] = {}
    day_starts: dict[str, datetime] = {}
    if rolling:
        rotation = [w.id for w in active.workouts]
        by_workout = {w.id: CatchupWorkout(id=w.id, name=w.name) for w in active.workouts}

    out: list[CatchupDay] = []
    for i in range(days):
        d = today_local - timedelta(days=i)
        key = d.isoformat()
        weekday = (d.weekday() + 1) % 7  # 0=Sun..6=Sat
        sessions = by_date.get(key, [])
        if rolling:
            day_starts[key] = datetime.combine(d, datetime.min.time()) + shift
            scheduled = []
        else:
            scheduled = scheduled_by_weekday.get(weekday, [])
        out.append(
            CatchupDay(
                date=key,
                weekday=weekday,
                scheduled=scheduled,
                sessions=sessions,
                logged=bool(sessions),
            )
        )

    if rolling:
        for row in out:
            # Where the rotation stood at the start of that day — for a logged
            # day that is the day it was credited to, for an unlogged one it is
            # what was outstanding.
            history = _rotation_history(db, user.id, rotation, before=day_starts[row.date])
            due = up_next(rotation, history)
            if due is not None and due in by_workout:
                row.scheduled = [by_workout[due]]
    return out


@router.get("/presets", response_model=list[PresetSplit])
def list_presets(user: User = Depends(get_current_user)) -> list[PresetSplit]:
    """The library of well-known programs (PPL, Upper/Lower, 5x5, ...).

    Deliberately unauthenticated-safe data — it's the same for everyone — but
    it sits behind the router's usual auth so the spotter reaches it with the
    caller's token like every other tool.
    """
    return [PresetSplit(**p) for p in preset_library.summaries()]


@router.post("/presets/{slug}/adopt", response_model=AdoptedPreset, status_code=status.HTTP_201_CREATED)
def adopt_preset(
    slug: str,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AdoptedPreset:
    """Copy a preset into the athlete's own splits.

    A copy, never a live link: from here it's an ordinary split, editable
    without touching the library and unaffected by any change to it.

    Movement names resolve through the same matcher the importer and the
    spotter use, so the preset can name lifts the way a person would. Anything
    the catalog can't match is reported back rather than dropped in silence —
    a program missing two of its lifts is not the program.
    """
    preset = preset_library.get(slug)
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown preset")

    split = Split(
        owner_id=user.id,
        name=preset["name"],
        mode=preset["mode"],
        rules=list(preset_library.DEFAULT_RULES),
        notes=preset["description"],
        # Adopting with no plan at all should just work; adopting while
        # mid-program must not silently switch what you're training.
        is_active=db.scalar(
            select(Split.id).where(Split.owner_id == user.id).limit(1)
        ) is None,
    )
    db.add(split)
    db.flush()

    unmatched: list[str] = []
    for order, day in enumerate(preset["days"]):
        workout = Workout(
            owner_id=user.id,
            name=day["name"],
            split_id=split.id,
            # A rolling program is a cycle; giving its days weekdays would be
            # inventing a schedule the program doesn't have.
            weekdays=[] if preset["mode"] == "rolling" else list(day["weekdays"]),
            order=order,
        )
        db.add(workout)
        db.flush()
        position = 0
        for item in day["exercises"]:
            exercise_id, _ = match_exercise(db, user.id, item["exercise"])
            if exercise_id is None:
                unmatched.append(item["exercise"])
                continue
            db.add(
                WorkoutExercise(
                    workout_id=workout.id,
                    exercise_id=exercise_id,
                    order=position,
                    target_sets=item["target_sets"],
                    target_reps=item["target_reps"],
                    target_reps_max=item.get("target_reps_max"),
                )
            )
            position += 1

    db.commit()
    db.refresh(split)
    return AdoptedPreset(split=SplitOut.model_validate(split), unmatched=unmatched)


@router.get("/{split_id}", response_model=SplitOut)
def get_split(
    split_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SplitOut:
    return SplitOut.model_validate(_get_owned(db, split_id, user))


@router.patch("/{split_id}", response_model=SplitOut)
def update_split(
    split_id: int,
    payload: SplitUpdate,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SplitOut:
    split = _get_owned(db, split_id, user)
    if payload.name is not None:
        split.name = payload.name
    if payload.mode is not None:
        split.mode = payload.mode
    if payload.rules is not None:
        split.rules = payload.rules
    if payload.notes is not None:
        split.notes = payload.notes
    if payload.is_active is not None:
        if payload.is_active:
            # Only one active split per user.
            for other in db.scalars(
                select(Split).where(Split.owner_id == user.id, Split.id != split.id)
            ):
                other.is_active = False
        split.is_active = payload.is_active
    db.commit()
    db.refresh(split)
    return SplitOut.model_validate(split)


@router.delete("/{split_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_split(
    split_id: int,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    split = _get_owned(db, split_id, user)
    # Detach day-workouts (SET NULL) so they survive as standalone workouts.
    for w in db.scalars(select(Workout).where(Workout.split_id == split.id)):
        w.split_id = None
    db.delete(split)
    db.commit()
