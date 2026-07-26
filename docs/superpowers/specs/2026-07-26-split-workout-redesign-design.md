# Split / Workout Redesign — Design

**Date:** 2026-07-26
**Status:** Approved for planning
**Scope:** Rework the training-plan model and its vocabulary. Full code rename to
match the settled user-facing terms, plus a single weekday-scheduling model that
replaces three overlapping mechanisms.

## Problem

The plan model accreted three overlapping ways to say "which day → which
routine," and the vocabulary drifted:

- `Split.schedule` — a loose JSON list (`{"day": "Monday", "label": "Push"}`),
  referencing routines by label string, not id.
- `Routine.day_label` + `day_order` — a single day label stored on each routine.
- `ScheduleDay` — a separate table mapping weekday `0–6` → `routine_id`, and it is
  **Monday-first**, clashing with the intended Sunday–Saturday week.

Separately, the UI inconsistently calls a single day-routine a "split" (left over
from an early `Routine → Split` display rename that predated the `Split` model).

## Settled vocabulary

- **Split** — one week, **Sunday → Saturday**. A user may have several; exactly
  one is *active*.
- **Workout** — one day's training; holds exercises; assigned to one or more
  weekdays within a split.
- **Session** — an actual logged bout (what was performed).
- **Exercise** — unchanged (catalog entry).

Full rename: code names match these user-facing terms (chosen over "UI-labels-only"
to eliminate drift permanently).

## Decisions

1. **Full rename, code = UI.** No permanent code↔UI glossary drift.
2. **Clean schema rebuild.** The deployed homelab instance has no data worth
   preserving, so recreate the schema with the new models and re-seed the exercise
   catalog rather than writing an ordered rename migration. Existing rows on that
   instance are intentionally discarded.
3. **One scheduling model.** A workout carries the weekdays it occupies plus a
   floating flag; `Split.schedule`, `Routine.day_label`/`day_order`, and
   `ScheduleDay` are removed.
4. **"Done this week" is derived,** never stored — computed from logged sessions.
5. **One active split** drives Home; switch anytime (extends existing `is_active`).

## Rename map

| Concept | Code before | Code after | API path before → after |
|---|---|---|---|
| The week | `Split` | `Split` | `/api/splits` (unchanged) |
| A plan-day | `Routine` | `Workout` | `/api/routines` → `/api/workouts` |
| Plan-day's exercises | `RoutineExercise` | `WorkoutExercise` | — |
| A logged bout | `Workout` | `Session` | `/api/workouts` → `/api/sessions` |
| Bout's exercises | `WorkoutExercise` | `SessionExercise` | — |
| The sets | `SetEntry` | `SetEntry` | — |
| Per-weekday schedule | `ScheduleDay` | *(removed)* | — |

**Name-collision hazard:** `WorkoutExercise` changes meaning (session-line →
plan-line). Because this is a clean rebuild, there is no in-place table rename —
the new schema is created fresh with the final names. FK columns take their new
names directly: `set.session_exercise_id`, `session.source_workout_id`,
`workout_exercise.workout_id`.

## Data model (after)

- **Split**: `owner_id`, `name`, `is_active` (one active per user, enforced on
  set), `rules` (JSON, kept), `notes`. Drops `schedule`. Owns `Workout`s.
- **Workout** (plan-day): `owner_id`, `split_id` (nullable — standalone allowed),
  `name`, `notes`, `order`, **`weekdays: list[int]`** (0=Sun … 6=Sat), **`floating:
  bool`**. Drops `day_label`. Owns ordered `WorkoutExercise`s.
- **WorkoutExercise** (plan-line): as the old `RoutineExercise` — `exercise_id`,
  `order`, `target_sets`, `target_reps`, `target_reps_max`, `target_weight`,
  `rest_seconds`, `notes`.
- **Session** (logged): as the old `Workout` — `owner_id`, `name`, `started_at`,
  `finished_at`, `notes`, `source_workout_id` (nullable FK → `workout`, was
  `source_routine_id`). Owns ordered `SessionExercise`s.
- **SessionExercise** (log-line): as the old `WorkoutExercise` — `exercise_id`,
  `order`, `notes`, and the target snapshot fields. Owns `SetEntry`s.
- **SetEntry**: unchanged except FK `session_exercise_id`.
- **Removed:** `ScheduleDay`.

### `weekdays` + `floating` semantics
- `floating = false` (fixed): the workout is done on **every** weekday in
  `weekdays` (e.g. Push on Mon **and** Thu → two sessions/week).
- `floating = true`: the workout is **one** session done on **any one** of its
  candidate weekdays (Legs on Fri **or** Sat). Once logged that week it clears from
  the remaining candidate day(s).
- `weekdays = []`: unscheduled — the workout exists in the split but is not on the
  calendar. Allowed.
- Validation: each value in `0..6`, no duplicates.
- Rest day: a weekday no workout in the active split is assigned to.

### "Done this week"
Derived, not stored. A workout counts as done for the current week when a
`Session` exists with `source_workout_id == workout.id` and `started_at` within
the current Sunday-based week `[Sunday 00:00 local … next Sunday)`. For a floating
workout, one such session marks it done across all its candidate days.

## Endpoints

- **`/api/workouts`** (was `/api/routines`): CRUD for plan-days, request/response
  now include `weekdays` + `floating`.
- **`/api/sessions`** (was `/api/workouts`): logging — `start`, `log`, `finish`,
  workout-exercise and set sub-resources. Behavior unchanged; `source_workout_id`
  replaces `source_routine_id` in payloads.
- **`/api/splits`**: CRUD + active-toggle unchanged; no separate schedule field —
  the schedule is the member workouts' `weekdays`.
- **New `GET /api/splits/today`**: returns the active split's workout(s) for the
  current weekday, each with a `done_this_week` boolean. Centralizes the Sun–Sat +
  floating derivation server-side (previously computed in the client).
- **`/api/stats/summary`** (`routes/stats.py`): unchanged path, but its queries
  reference the renamed models directly (`select(Workout)`, `join(WorkoutExercise…)`,
  `SetEntry.workout_exercise_id`, `WorkoutExercise.exercise_id`) → must move to
  `Session`, `SessionExercise`, `session_exercise_id`. **Deliberate note:** stats'
  "this week" is a rolling 7-day window (`week_ago`) and stays that way — it is a
  *volume* metric, distinct from the split's Sunday-based "done this week." The two
  are intentionally different; a code comment will say so to prevent future
  "bug" confusion.
- **companion `EXPOSE`**: update the tool allowlist to the new paths
  (`/api/workouts`, `/api/sessions`, `/api/splits/*`, `/api/stats/*`).

### Route-module rename order
Mirrors the model collision: `routes/workouts.py` (logged bouts) → `routes/sessions.py`
**first**, then `routes/routines.py` (plans) → `routes/workouts.py`. `main.py`'s
router imports/registration and the `/api` prefix wiring update accordingly.

### AI import pipeline (plan-day = "Routine" today)
The natural-language program importer models the plan-day as "Routine" throughout
and must rename with it (`Routine → Workout`), or the vocabulary drift simply moves
here. In scope for this redesign:
- `api/app/ai/base.py` — `ParsedRoutine`/`ParsedRoutineExercise`, `ParsedProgram.routines`,
  `EDIT_ROUTINE_SCHEMA`, `EditedRoutine`, `PROGRAM_SCHEMA`/`_ROUTINE_EXERCISE_ITEM`.
- `api/app/ai/prompts.py` — `routine_system_prompt`, `edit_routine_*`, rule text.
- `api/app/ai/service.py` — `_build_routine_result`, `program.routines`, the
  `parse_routine` / `parse_routine_stream` / `edit_routine_stream` entrypoints.
- `api/app/routes/ai.py` — `RoutineRequest`, `EditRoutineRequest`, the
  `/parse-routine`, `/parse-routine/stream`, `/edit-routine/stream` route names →
  `/parse-workout`, etc.
- `frontend/src/app/routine-import.tsx` → `workout-import.tsx` (`ParsedRoutine`,
  `ParseRoutineResult`, `RoutineExerciseInput`, and the calling client methods).

The exercise-*matcher* itself (`_match`/`_stem`) is name-neutral and untouched.

## Frontend

- **Screen renames:** `app/routine/*` → `app/workout/*`; `app/routine-import.tsx`
  (top-level sibling) → `app/workout-import.tsx`; `app/workout/{active,log,
  add-exercise,[id]}` → `app/session/*`. Components `RoutineEditor` →
  `WorkoutEditor`, `RoutineAiEdit` → `WorkoutAiEdit`; matching `api/client`,
  `api/types`, `state` (active-session), and all display strings.
- **`lib/offline.ts`** (offline set-logging queue): models the *logged bout*, so it
  renames with `Workout → Session` — the `Workout`/`WorkoutSet` types, the
  `CACHE_KEY = 'gymapp.offline.workout'` storage key, `cacheWorkout` /
  `readCachedWorkout` / `dropWorkoutFromQueue` / `withPendingSets`, and
  `QueuedSet.workoutId`. Bumping the storage-key string also harmlessly discards any
  stale offline cache under the old key (acceptable — clean rebuild).
- **`lib/export.ts`**: `Routine`/`Workout` types + `routineToText`/`routineToJson`/
  `workoutToText`/`workoutToJson` rename to the plan/session split, along with the
  wire discriminator strings (`type: 'routine'` → `'workout'`, `type: 'workout'` →
  `'session'`). Consumers `app/workout/[id].tsx` (plan) and `app/session/[id].tsx`
  (log) update with them.
- **Tabs:** current "Routines" (plans) → **Workouts**; current "Workouts" (log
  history) → **History**. Result: Home / Workouts / History / Coach / Settings.
- **New UI:** in the workout editor, a Sun–Sat weekday picker + a "floating (do
  once)" toggle. The split screen renders the week as a Sun–Sat grid of assigned
  workouts and rest days, using `GET /api/splits/today` for today's highlight/done
  state.

## Edge cases & error handling
- Empty `weekdays` → unscheduled workout; valid, simply absent from the calendar.
- Floating workout logged → derived "done" clears it from remaining candidate days
  that week.
- Switch active split mid-week → Home reflects the new active split; done-status is
  per-workout, so no conflict or reset needed.
- Delete a split → member workouts detach to standalone (`split_id = null`), as
  today.
- Invalid `weekdays` (out of range / duplicate) → 422 from schema validation.

## Testing
- **Backend (pytest):**
  - Existing `tests/test_workouts.py` (currently the logged-bout endpoints) is
    **renamed** to `tests/test_sessions.py` and repointed at `/api/sessions`; a new
    `tests/test_workouts.py` covers the plan-day endpoints.
  - Workout CRUD carries `weekdays` + `floating`; validation rejects bad weekdays.
  - Session logging works at `/api/sessions` (start → add exercise → add set →
    finish); `source_workout_id` snapshots targets.
  - `GET /api/splits/today` derivation: fixed workout appears on each assigned day;
    floating workout marked done across candidate days after one session; week
    boundary (Sun-based) respected.
  - Split active-toggle keeps exactly one active per user.
  - New `tests/test_stats.py`: `/stats/summary` runs against the renamed
    `Session`/`SessionExercise` models (guards the query breakage the rename would
    otherwise hide).
- **Frontend:** `tsc --noEmit` passes; smoke-run the app (Metro) to confirm the
  renamed routes resolve.

## Rename ripple — file inventory
The single source of truth for what the rename touches (the prose above narrates
these; this is the checklist):

**Backend**
- `models.py` — the six model renames + FK columns; remove `ScheduleDay`.
- `schemas.py` — `Routine*`→`Workout*`, `Workout*`→`Session*` DTOs; add `weekdays` +
  `floating`; drop `schedule`, `day_label`.
- `routes/routines.py`→`workouts.py`; `routes/workouts.py`→`sessions.py`;
  `routes/splits.py` (+ `today`); `routes/stats.py` (queries); `routes/ai.py`.
- `ai/base.py`, `ai/prompts.py`, `ai/service.py` — the import pipeline.
- `ai/companion_setup.py` — `EXPOSE` paths.
- `main.py` — router imports/registration.
- `db.py` — reset `_ADDED_COLUMNS` to the new base schema.
- `seed/*` — only if any seed references old model/table names (verify; catalog
  seed touches `Exercise` only, expected untouched).
- `tests/` — as above.

**Frontend**
- `app/routine/*`→`app/workout/*`; `app/routine-import.tsx`→`app/workout-import.tsx`;
  `app/workout/*`→`app/session/*`; `(tabs)/routines.tsx`→workouts, `(tabs)/workouts.tsx`
  →history, `(tabs)/_layout.tsx` labels; `(tabs)/index.tsx` (Home today logic).
- `components/RoutineEditor.tsx`→`WorkoutEditor.tsx`, `RoutineAiEdit.tsx`→`WorkoutAiEdit.tsx`.
- `api/types.ts`, `api/client.ts` — type + method + path renames.
- `state/active-workout.tsx` — session state + its use of `offline.ts`.
- `lib/offline.ts`, `lib/export.ts` — as above.

## Out of scope (deferred)
- Calendar-scheduled splits / mesocycle periodization (chose one-active-toggle).
- Progression nudges, per-muscle volume (separate roadmap items).
- Preserving existing homelab data (clean rebuild chosen).

## Documentation to update
- `ARCHITECTURE.md` — data-model section, the plan-vs-log naming, endpoints.
- `ROADMAP.md` — close the "Terminology cleanup" launch-prep item; note the
  redesign.
- `db.py` — reset `_ADDED_COLUMNS` to reflect the new base schema.
