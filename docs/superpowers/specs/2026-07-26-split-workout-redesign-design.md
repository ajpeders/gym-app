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
- **companion `EXPOSE`**: update the tool allowlist to the new paths
  (`/api/workouts`, `/api/sessions`, `/api/splits/*`, `/api/stats/*`).

## Frontend

- **Screen renames:** `app/routine/*` → `app/workout/*`; `app/workout/{active,log,
  add-exercise,[id]}` → `app/session/*`. Components `RoutineEditor` →
  `WorkoutEditor`, `RoutineAiEdit` → `WorkoutAiEdit`; matching `api/client`,
  `api/types`, `state` (active-session), and all display strings.
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
  - Workout CRUD carries `weekdays` + `floating`; validation rejects bad weekdays.
  - Session logging works at `/api/sessions` (start → add exercise → add set →
    finish); `source_workout_id` snapshots targets.
  - `GET /api/splits/today` derivation: fixed workout appears on each assigned day;
    floating workout marked done across candidate days after one session; week
    boundary (Sun-based) respected.
  - Split active-toggle keeps exactly one active per user.
- **Frontend:** `tsc --noEmit` passes; smoke-run the app (Metro) to confirm the
  renamed routes resolve.

## Out of scope (deferred)
- Calendar-scheduled splits / mesocycle periodization (chose one-active-toggle).
- Progression nudges, per-muscle volume (separate roadmap items).
- Preserving existing homelab data (clean rebuild chosen).

## Documentation to update
- `ARCHITECTURE.md` — data-model section, the plan-vs-log naming, endpoints.
- `ROADMAP.md` — close the "Terminology cleanup" launch-prep item; note the
  redesign.
- `db.py` — reset `_ADDED_COLUMNS` to reflect the new base schema.
