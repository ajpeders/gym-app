# Split / Workout Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the training-plan model to the settled vocabulary (Split=week, Workout=day, Session=logged bout) and replace three overlapping day-scheduling mechanisms with one weekday model (`weekdays` + `floating`), with "done this week" derived from logged sessions.

**Architecture:** Backend is FastAPI + SQLAlchemy over SQLite; frontend is Expo Router + React Native + TypeScript. This is a **clean schema rebuild** (no in-place data migration — the homelab DB is wiped and the exercise catalog re-seeded). Backend renames land first (models → schemas → routes → AI/companion → tests), then the frontend follows the new API, then the new weekday-scheduling UI.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2.0, pytest; Expo 54, React Native, NativeWind, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-26-split-workout-redesign-design.md`

**Working style:** Do this on a branch (`redesign/split-workout`), not directly on main. Commit after every green step. Backend tests run in the `uv` venv from HOWTO (`cd api && uv venv .venv && uv pip install -r requirements.txt`, then `.venv/bin/python -m pytest -q`). Frontend checks: `cd frontend && npx tsc --noEmit`.

---

## Chunk 1: Backend models, schemas, clean rebuild

Renames the ORM models and DTOs, adds `weekdays`/`floating`, removes `ScheduleDay`, and resets the schema. No route/logic changes yet — this chunk ends with the app importing and `create_all()` producing the new tables.

### Task 1.1: Rename models and add scheduling fields

**Files:**
- Modify: `api/app/models.py`
- Modify: `api/app/db.py`

- [ ] **Step 1: Apply the model renames in `models.py`.** Class/table/relationship renames (meaning-preserving):
  - `Routine` → `Workout` (table `routine`→`workout`); add columns `weekdays: Mapped[list[int]] = mapped_column(JSON, default=list)` and `floating: Mapped[bool] = mapped_column(Boolean, default=False)`; **remove** `day_label` and `day_order`; keep `split_id`, `name`, `notes`; add `order: Mapped[int] = mapped_column(Integer, default=0)` (replaces `day_order`). Relationship `exercises` now targets `WorkoutExercise` (plan-line).
  - `RoutineExercise` → `WorkoutExercise` (table `routine_exercise`→`workout_exercise`); FK `routine_id`→`workout_id`; relationship back_populates `workout`.
  - `Workout` (logged) → `Session` (table `workout`→`session`); FK `source_routine_id`→`source_workout_id` (FK target `workout.id`); relationship `exercises` → `SessionExercise`.
  - `WorkoutExercise` (logged) → `SessionExercise` (table `workout_exercise`→`session_exercise`); FK `workout_id`→`session_id`; relationship back_populates `session`; `sets` relationship unchanged.
  - `SetEntry`: FK `workout_exercise_id`→`session_exercise_id`; relationship back_populates unchanged name `session_exercise`.
  - `Split`: **remove** `schedule` column; keep `rules`, `is_active`, `name`, `notes`; `routines` relationship → `workouts` (order_by `Workout.order`).
  - **Delete** the `ScheduleDay` class entirely.
  - Update `User` relationships: `routines`→(removed; workouts reached via splits/standalone), `workouts`→`sessions`. Keep `metrics`, `settings`. (A user's plan-workouts are reached through splits or `Workout.owner_id`; keep a `sessions` relationship on User for the logged bouts.)
  - **Fix the matching `back_populates` strings** (else `configure_mappers()` raises on import): plan-`Workout.owner` → `back_populates="..."` unused (User no longer has a plan-workout collection, so make `Workout.owner` a plain `relationship()` with no back_populates, or drop it); plan-`Workout.split` → `back_populates="workouts"`; logged-`Session.owner` → `back_populates="sessions"`. Every renamed relationship's counterpart string must be updated in lockstep.

- [ ] **Step 2: Reset `_ADDED_COLUMNS` in `db.py`.** The list currently references old table names (`routine`, `routine_exercise`, `workout_exercise`, plus the deleted `sets.*`/`exercise.tracking_type` which are now part of the base schema on a clean rebuild). Replace the whole list with `[]` (empty) — the clean rebuild bakes every column into `create_all()`, so no additive migrations are pending. Leave the `_ensure_columns()` machinery in place for future use.

- [ ] **Step 3: Verify the app imports and builds the schema.**

Run: `cd api && .venv/bin/python -c "from app.db import init_db; init_db(); print('schema OK')"`
Expected: prints `schema OK` (creates the new tables in `./data/gym.db`; delete any stale `api/data/gym.db` first so the clean tables are created).

- [ ] **Step 4: Commit.**

```bash
git add api/app/models.py api/app/db.py
git commit -m "refactor(models): rename to Split/Workout/Session + weekday scheduling"
```

### Task 1.2: Rename schemas + add scheduling fields

**Files:**
- Modify: `api/app/schemas.py`

- [ ] **Step 1: Rename the DTOs to match the models.** `Routine*`→`Workout*` (plan), `Workout*`→`Session*` (log), keeping every field. On the plan-workout Out/Create/Update DTOs: add `weekdays: list[int]` and `floating: bool`; remove `day_label`/`day_order`, add `order`. On `SplitOut/Create/Update`: remove `schedule`. **Explicitly rename the session-start payload field `WorkoutStart.routine_id` → `WorkoutStart.workout_id`** (the FK into a plan `Workout`) — this is the "start a session from a plan-workout" input that Task 2.2's test posts and that `source_workout_id` is derived from; if left as `routine_id`, the started session's source stays unset and Task 2.2 fails. Add a validator on `weekdays` (each int in `0..6`, no duplicates) — raise on violation so FastAPI returns 422:

```python
from pydantic import field_validator

class WorkoutBase(BaseModel):
    # ...
    weekdays: list[int] = []
    floating: bool = False

    @field_validator("weekdays")
    @classmethod
    def _valid_weekdays(cls, v: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("weekdays must be 0..6 (0=Sunday)")
        if len(set(v)) != len(v):
            raise ValueError("weekdays must not repeat")
        return v
```

- [ ] **Step 2: Add the `today` response DTO.**

```python
class TodayWorkout(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    floating: bool
    weekdays: list[int]
    done_this_week: bool
```

- [ ] **Step 3: Verify import.** Run: `cd api && .venv/bin/python -c "import app.schemas; print('schemas OK')"` → `schemas OK`.

- [ ] **Step 4: Commit.**

```bash
git add api/app/schemas.py
git commit -m "refactor(schemas): rename DTOs + weekdays/floating + TodayWorkout"
```

---

## Chunk 2: Backend routes, derivation endpoint, AI pipeline, companion

Renames the route modules (collision-safe order), wires the new scheduling fields through, adds `GET /api/splits/today` with the derived "done this week", and renames the AI import pipeline + companion allowlist.

### Task 2.1: Rename route modules (collision-safe)

**Files:**
- Rename: `api/app/routes/workouts.py` → `api/app/routes/sessions.py` (logged bouts)
- Rename: `api/app/routes/routines.py` → `api/app/routes/workouts.py` (plans)
- Modify: `api/app/main.py`

- [ ] **Step 1: `git mv` the session routes first, then the plan routes.**

```bash
cd api/app/routes
git mv workouts.py sessions.py
git mv routines.py workouts.py
```

- [ ] **Step 2: In `sessions.py`** (was workouts.py): `router = APIRouter(prefix="/sessions", tags=["sessions"])`; update model imports `Workout→Session`, `WorkoutExercise→SessionExercise`; `source_routine_id`→`source_workout_id`; `start_workout` reads `payload.workout_id` (renamed in Task 1.2) to set `source_workout_id`; helper/var names `workout`→`session`; the "start from a plan" logic reads a plan `Workout` by id and snapshots its `WorkoutExercise` targets onto `SessionExercise`. **Name-collision note:** this file imports both the SQLAlchemy `Session` (type of `db`) and the ORM model `Session`. It's benign at runtime because `from __future__ import annotations` makes the `db: Session` annotation an unevaluated string and `Depends(get_db)` supplies the value — but for clarity import the SA session type as `from sqlalchemy.orm import Session as SASession` and annotate `db: SASession`. Apply the same convention wherever both are imported (`splits.py`, `stats.py`).

- [ ] **Step 3: In `workouts.py`** (was routines.py): `router = APIRouter(prefix="/workouts", tags=["workouts"])`; `Routine→Workout`, `RoutineExercise→WorkoutExercise`; accept/return `weekdays`+`floating`, drop `day_label`/`day_order`, use `order`.

- [ ] **Step 4: Update `main.py`** router imports and the `include_router` loop: replace `routines`→`workouts` and `workouts`→`sessions` module references (order in the tuple is cosmetic; names must resolve).

- [ ] **Step 5: Verify import.** Run: `cd api && .venv/bin/python -c "import app.main; print('app OK')"` → `app OK`.

- [ ] **Step 6: Commit.**

```bash
git add -A api/app/routes api/app/main.py
git commit -m "refactor(routes): /routines->/workouts (plans), /workouts->/sessions (log)"
```

### Task 2.2: `GET /api/splits/today` with derived done-this-week

**Files:**
- Modify: `api/app/routes/splits.py`
- Test: `api/tests/test_splits.py` (new)

- [ ] **Step 1: Write the failing test** covering fixed + floating derivation and the week boundary.

```python
# api/tests/test_splits.py
from datetime import datetime, timezone

def _mk_workout(client, headers, split_id, name, weekdays, floating):
    r = client.post("/api/workouts", headers=headers, json={
        "name": name, "split_id": split_id, "weekdays": weekdays,
        "floating": floating, "exercises": []})
    assert r.status_code == 201, r.text
    return r.json()["id"]

def test_today_marks_fixed_and_floating(client, auth, monkeypatch):
    headers, _, _ = auth
    split = client.post("/api/splits", headers=headers, json={"name": "PPL"}).json()
    client.patch(f"/api/splits/{split['id']}", headers=headers, json={"is_active": True})
    # A workout scheduled for every weekday so "today" always has one.
    wid = _mk_workout(client, headers, split["id"], "Full", list(range(7)), False)

    today = client.get("/api/splits/today", headers=headers)
    assert today.status_code == 200
    items = today.json()
    assert any(w["id"] == wid for w in items)
    assert all(w["done_this_week"] is False for w in items)

    # Log a session sourced from it -> done_this_week becomes True.
    client.post("/api/sessions/start", headers=headers, json={"workout_id": wid})
    again = client.get("/api/splits/today", headers=headers)
    assert next(w for w in again.json() if w["id"] == wid)["done_this_week"] is True
```

- [ ] **Step 2: Run it, expect FAIL** (`/api/splits/today` 404). Run: `cd api && .venv/bin/python -m pytest tests/test_splits.py -q`.

- [ ] **Step 3: Implement the endpoint + helper.** Add to `splits.py`:

```python
from datetime import datetime, timedelta, timezone
from ..models import Session, Workout
from ..schemas import TodayWorkout

def _week_start(now: datetime) -> datetime:
    """Sunday 00:00 of the current week. Uses UTC (sessions store started_at in
    UTC and no per-user timezone is tracked) — a deliberate deviation from the
    spec's 'local'; revisit if user timezones are added. weekday(): Mon=0..Sun=6."""
    days_since_sun = (now.weekday() + 1) % 7
    d = (now - timedelta(days=days_since_sun)).replace(hour=0, minute=0, second=0, microsecond=0)
    return d

def _done_this_week(db, user_id, workout_id, now) -> bool:
    start = _week_start(now)
    return db.scalar(
        select(Session.id).where(
            Session.owner_id == user_id,
            Session.source_workout_id == workout_id,
            Session.started_at >= start,
        ).limit(1)
    ) is not None

@router.get("/today", response_model=list[TodayWorkout])
def today(db: SASession = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    weekday = (now.weekday() + 1) % 7  # 0=Sun..6=Sat
    active = db.scalar(select(Split).where(Split.owner_id == user.id, Split.is_active.is_(True)))
    if active is None:
        return []
    out = []
    for w in active.workouts:
        if weekday in (w.weekdays or []):
            out.append(TodayWorkout(
                id=w.id, name=w.name, floating=w.floating, weekdays=w.weekdays,
                done_this_week=_done_this_week(db, user.id, w.id, now),
            ))
    return out
```

Note: import the SQLAlchemy session type as `from sqlalchemy.orm import Session as SASession` and annotate `db: SASession` throughout the file, so it never clashes with the ORM `Session` model (same convention as `sessions.py`/`stats.py`).

- [ ] **Step 4: Run tests, expect PASS.** Run: `cd api && .venv/bin/python -m pytest tests/test_splits.py -q`.

- [ ] **Step 5: Commit.**

```bash
git add api/app/routes/splits.py api/tests/test_splits.py
git commit -m "feat(splits): GET /splits/today with derived done-this-week"
```

### Task 2.3: stats.py + AI pipeline + companion allowlist

**Files:**
- Modify: `api/app/routes/stats.py`, `api/app/routes/ai.py`
- Modify: `api/app/ai/base.py`, `api/app/ai/prompts.py`, `api/app/ai/service.py`
- Modify: `api/app/ai/companion_setup.py`

- [ ] **Step 1: `stats.py`** — repoint queries to `Session`/`SessionExercise`/`session_exercise_id`. Import the ORM model as `Session` and the SA session type as `SASession` (it currently imports `from sqlalchemy.orm import Session`) so `select(Session)` (model) and `db: SASession` (type) don't collide. Add a one-line comment above the `week_ago` calc: `# rolling 7-day volume window — intentionally NOT the split's Sunday-based "done this week"`.

- [ ] **Step 2: AI import pipeline** — mechanical `Routine→Workout` rename of the symbols listed in the spec's "AI import pipeline" section (`ParsedRoutine`, `ParsedRoutineExercise`, `ParsedProgram.routines`, `PROGRAM_SCHEMA`/`_ROUTINE_EXERCISE_ITEM`, `EDIT_ROUTINE_SCHEMA`, `EditedRoutine`, `_build_routine_result`, `routine_system_prompt`, `edit_routine_*`, and route names `/parse-routine*`→`/parse-workout*`, `/edit-routine/stream`→`/edit-workout/stream`, `RoutineRequest`→`WorkoutRequest`, `EditRoutineRequest`→`EditWorkoutRequest`). The `_match`/`_stem` matcher is untouched.

- [ ] **Step 3: `companion_setup.py`** — update `EXPOSE` to `GET/POST /api/workouts*`, `GET/POST /api/sessions*`, `PATCH /api/sessions/*`, `GET /api/splits*`, `GET /api/stats/*`; keep `EXCLUDE` for auth/settings/profile/ai. **Deliberate parity:** the old allowlist exposed `PATCH /api/workouts/*` (logged bouts, now `sessions`) but not `PATCH` on plans (`routines`) — so plan editing stays off-limits to the coach, unchanged. Only add `PATCH /api/workouts/*` if you intend to newly let the coach edit plans (out of scope here).

- [ ] **Step 4: Verify import.** Run: `cd api && .venv/bin/python -c "import app.main; print('ok')"` → `ok`.

- [ ] **Step 5: Commit.**

```bash
git add api/app/routes/stats.py api/app/routes/ai.py api/app/ai
git commit -m "refactor(ai,stats): follow Session/Workout rename + new paths"
```

### Task 2.4: Rename + extend backend tests

**Files:**
- Rename: `api/tests/test_workouts.py` → `api/tests/test_sessions.py`
- Create: `api/tests/test_workouts.py` (plan-day CRUD), `api/tests/test_stats.py`

- [ ] **Step 1: `git mv test_workouts.py test_sessions.py`**; repoint its endpoints to `/api/sessions` and payload key `workout_id` (source). Fix the settings assertion already removed earlier.

- [ ] **Step 2: New `test_workouts.py`** — plan-day CRUD asserting `weekdays`/`floating` round-trip and that bad weekdays (`[7]`, `[1,1]`) return 422.

- [ ] **Step 3: New `test_stats.py`** — log a session with sets, assert `/api/stats/summary` returns 200 with expected volume (guards the renamed queries).

- [ ] **Step 4: Full suite green.** Run: `cd api && .venv/bin/python -m pytest -q` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add api/tests
git commit -m "test: rename session tests, add plan-workout + stats coverage"
```

---

## Chunk 3: Frontend — follow the renamed API

Mechanical rename of screens, components, api client/types, state, and the offline/export libs so the app talks to the new endpoints and vocabulary. No new UI yet.

### Task 3.1: api layer + libs

**Files:**
- Modify: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/lib/offline.ts`, `frontend/src/lib/export.ts`

- [ ] **Step 1: `api/types.ts`** — `Routine*`→`Workout*` (plan, add `weekdays: number[]`, `floating: boolean`, drop `day_label`/`day_order`), `Workout*`→`Session*` (log). Add `TodayWorkout`.
- [ ] **Step 2: `api/client.ts`** — method + path renames: `routines()`→`workouts()` (`/routines`→`/workouts`), `workouts()`→`sessions()` (`/workouts`→`/sessions`), AI import paths, add `splitToday()` → `/splits/today`.
- [ ] **Step 3: `lib/offline.ts`** — `Workout`/`WorkoutSet` types → `Session`; `CACHE_KEY='gymapp.offline.session'`; rename `cacheWorkout`/`readCachedWorkout`/`dropWorkoutFromQueue`/`withPendingSets` and `QueuedSet.workoutId`→`sessionId`.
- [ ] **Step 4: `lib/export.ts`** — `routineTo*`/`workoutTo*` renames + wire discriminators (`'routine'`→`'workout'`, `'workout'`→`'session'`).
- [ ] **Step 5: Typecheck (will still error in screens — that's expected; verify these files themselves are consistent by checking the error set shrinks to screen/component files only).** Run: `cd frontend && npx tsc --noEmit`.
- [ ] **Step 6: Commit.** `git add frontend/src/api frontend/src/lib && git commit -m "refactor(fe): api + offline/export follow Session/Workout rename"`

### Task 3.2: screens, components, state, tabs

**Files:**
- Rename: `app/routine/*`→`app/workout/*`; `app/routine-import.tsx`→`app/workout-import.tsx`; `app/workout/*`→`app/session/*` (via `git mv`).
- Rename: `components/RoutineEditor.tsx`→`WorkoutEditor.tsx`, `RoutineAiEdit.tsx`→`WorkoutAiEdit.tsx`.
- Modify: `state/active-workout.tsx`, `(tabs)/_layout.tsx`, `(tabs)/routines.tsx`→workouts, `(tabs)/workouts.tsx`→history, `(tabs)/index.tsx`.

- [ ] **Step 1: `git mv` the screen dirs/files and components** to their new names.
- [ ] **Step 2: Update imports, component names, `useRouter().push` paths, and all display strings** ("split"/"routine" → "workout"; log screens → "session"/"History"). Tabs: `routines`→`workouts` (label "Workouts"), `workouts`→`history` (label "History"); update `_layout.tsx` `Tabs.Screen name=` + icons.
- [ ] **Step 3: `(tabs)/index.tsx`** — Home reads `client.splitToday()` for today's workout(s) + done state instead of computing from the active split's routines client-side.
- [ ] **Step 4: Typecheck clean.** Run: `cd frontend && npx tsc --noEmit` → no errors.
- [ ] **Step 5: Commit.** `git add -A frontend/src && git commit -m "refactor(fe): rename screens/tabs to Workout/Session vocabulary"`

---

## Chunk 4: New weekday-scheduling UI + docs

Adds the Sun–Sat weekday picker + floating toggle to the workout editor and the week grid to the split screen, then updates docs.

### Task 4.1: Weekday picker + floating toggle in WorkoutEditor

**Files:**
- Modify: `frontend/src/components/WorkoutEditor.tsx`
- Create: `frontend/src/components/WeekdayPicker.tsx`

- [ ] **Step 1: `WeekdayPicker.tsx`** — a controlled Sun–Sat row of 7 toggle chips; props `{ value: number[]; onChange: (d: number[]) => void }`; 0=Sun label "S M T W T F S". Toggling adds/removes the index.
- [ ] **Step 2: In `WorkoutEditor.tsx`** — add `weekdays` state (from the edited workout) + a `floating` switch (label "Do once — floating (e.g. Fri or Sat)"), rendered above Save. Include both in the save payload.
- [ ] **Step 3: Typecheck.** `cd frontend && npx tsc --noEmit` → clean.
- [ ] **Step 4: Commit.** `git add frontend/src/components && git commit -m "feat(fe): weekday picker + floating toggle in workout editor"`

### Task 4.2: Week grid on the split screen

**Files:**
- Modify: `frontend/src/app/split/[id].tsx`

- [ ] **Step 1:** Render the split's workouts as a Sun–Sat column list: each weekday shows the workout(s) assigned (a workout appears on each of its `weekdays`; floating ones tagged "or"); empty days show "Rest". Today's row highlighted; use `splitToday()` for done state.
- [ ] **Step 2: Typecheck.** `cd frontend && npx tsc --noEmit` → clean.
- [ ] **Step 3: Smoke-run.** Start Metro (`cd frontend && EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start`) with the API running; confirm split screen + editor render and today's workout shows. (See @HOWTO.md.)
- [ ] **Step 4: Commit.** `git add frontend/src/app/split && git commit -m "feat(fe): Sun-Sat week grid on split screen"`

### Task 4.3: Docs

**Files:**
- Modify: `ARCHITECTURE.md`, `ROADMAP.md`

- [ ] **Step 1: `ARCHITECTURE.md`** — update the data-model section (Split→Workout→WorkoutExercise plan; Session→SessionExercise→SetEntry log; weekdays/floating; drop ScheduleDay), the endpoint list (`/workouts`, `/sessions`, `/splits/today`), and the plan-vs-log naming paragraph.
- [ ] **Step 2: `ROADMAP.md`** — check off the "Terminology cleanup" launch-prep item; add a one-line note that the split/workout redesign shipped.
- [ ] **Step 3: Commit.** `git add ARCHITECTURE.md ROADMAP.md && git commit -m "docs: reflect split/workout redesign"`

- [ ] **Step 4: Full verification before finishing the branch.** Backend: `cd api && .venv/bin/python -m pytest -q` (all green). Frontend: `cd frontend && npx tsc --noEmit` (clean). Then follow @superpowers:finishing-a-development-branch.
