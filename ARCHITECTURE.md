# Architecture

How gym-app is put together: the system shape, the data model, how a request
flows, and the decisions worth knowing before you change something. See
`README.md` for the pitch, `HOWTO.md` for task recipes, `ROADMAP.md` for status.

## System shape

```
Expo app (iOS / Android / web)
      │  HTTPS + Bearer JWT
      ▼
Traefik  ── local-only@file (LAN/VPN) ── TLS
      │        /api  → gym-api (higher priority)
      │        /     → gym-web (catch-all)
      ▼
FastAPI (gym-api) ──► SQLite  (state/gym-app/api/gym.db)
      │            └► uploads/ (progress photos, under the backed-up state dir)
      │
      ├─► AI provider layer (per-user): Ollama (default) ⇄ Claude
      └─► companion coach ──(loopback HTTP, /api tools)──► itself
```

Two containers (`gym-api`, `gym-web`) built from this repo and wired into the
homelab `services/` stack via a compose `include:`. There is **no published host
port** — the API is reachable only through Traefik (TLS + a `local-only`
middleware that restricts to LAN/VPN). See `docker-compose.yml`.

## Backend

FastAPI + SQLAlchemy 2.0 (typed `Mapped[]` models) over SQLite. Python 3.13.

```
api/app/
  main.py        # app factory: mounts every router under /api, then companion
  config.py      # pydantic-settings, all env vars GYM_*-prefixed, lru_cached
  db.py          # engine, SessionLocal, init_db(), hand-rolled column migrations
  security.py    # bcrypt (passlib) + JWT (PyJWT); get_current_user dependency
  models.py      # ORM models (single module)
  schemas.py     # Pydantic request/response DTOs
  progression.py # "top of the rep range on every set" — pure, derived, unstored
  idempotency.py # remembers a write's answer so the offline queue can replay it
  routes/        # one APIRouter per resource — /splits (+ /splits/today),
                 #   /workouts, /sessions, /exercises, /metrics, /ai, ...
  ai/            # domain schemas, prompts, provider selection, companion wiring
  seed/          # exercise-catalog importers (wger + free-exercise-db)
  tests/         # pytest
```

**Layering.** Routes are thin: they depend on `get_db` (a request-scoped
`Session`) and `get_current_user`, validate/serialize with `schemas`, and enforce
ownership per query. Non-trivial logic (AI parsing, exercise matching, athlete
memory) lives in `ai/service.py`, not the route handlers.

**Config.** Everything is environment-driven via `GYM_*` vars (`config.py`).
`get_settings()` is `lru_cache`d, so it's read once. `database_url` and
`uploads_dir` are derived from `data_dir` so a single volume covers both.

## Data model

Owned by `User` (everything cascades on user delete). The core split is
**plan vs. log**: a **Workout** describes intent (the plan-day template), a
**Session** records what happened (a logged bout).

```
User ─┬─ Settings (1:1)          units, per-user AI provider config, feature flags
      ├─ AthleteProfile (1:1)    persistent AI memory (the Tier-1 moat)
      ├─ Split ── Workout ── WorkoutExercise         the PLAN (targets)
      ├─ Session ── SessionExercise ── SetEntry       the LOG (actuals)
      ├─ BodyMetric, ProgressPhoto
      └─ CoachMessage                                 coach chat history
Exercise   global catalog (owner_id NULL) + per-user custom (owner_id set)
```

Relationships that carry design intent:

- **Split → Workout → WorkoutExercise.** A `Split` is a weekly plan owning several
  day-`Workout`s; a standalone workout has `split_id = NULL`. Each `Workout` carries
  its own schedule: `weekdays` (a JSON list of 0=Sun..6=Sat) pins it to specific
  days, or `floating = true` marks it as "do whenever it fits" (unpinned). This
  replaced the old separate `ScheduleDay` table — scheduling now lives on the
  workout itself. `WorkoutExercise` holds targets (sets, a rep *range* via
  `target_reps`/`target_reps_max`, weight, rest).
- **Session → SessionExercise → SetEntry.** Starting a `Session` from a plan
  `Workout` **snapshots** the workout's targets onto each `SessionExercise`, so
  history keeps the intent even if the plan later changes. `SetEntry` records
  actuals (reps, weight, RPE, `duration_seconds`, per-set notes, `completed_at`).
- **Exercise.tracking_type** (`weight_reps` | `bodyweight` | `time`) decides how a
  set is measured — bodyweight moves make `weight` optional, timed moves log
  `duration_seconds` instead of reps×weight.
- **AthleteProfile** is per-user memory the AI reads *and* writes every session
  (experience, goals, injuries, equipment, preferences, durable notes, a
  transient `session_note`). It's injected into every coach/parse prompt.

Two things from the original sketch are deliberately **not** tables: live-session
state lives client-side (`frontend/src/state/active-workout.tsx`), and personal
records are computed on the fly in `/stats/summary` rather than stored.

## Request flow (typical write)

1. Client sends `Authorization: Bearer <jwt>`.
2. `get_current_user` (`security.py`) decodes the JWT (HS256, `GYM_JWT_SECRET`),
   loads the `User`, or raises 401.
3. The route validates the body against a `schemas` model.
4. It scopes every query by owner (`WHERE owner_id == user.id`) — a missing/foreign
   row is a 404, not a leak.
5. Mutations commit through the request-scoped `Session`; the response is a
   `model_validate`d DTO.

## AI layer

Two distinct coaching surfaces share one **provider seam** (the `companion`
package, extracted from this app):

1. **Structured parse endpoints** (`ai/service.py`, `routes/ai.py`) —
   `parse-sets`, `parse-days`, `parse-workout` (+stream), `edit-workout/stream`,
   `check-in`, `coach`. Each calls a provider's `complete_json` with a JSON schema, validates
   the output with Pydantic, then resolves free-text exercise names to catalog
   IDs via a bespoke **token-overlap matcher** (`_match`/`_stem`): stemming,
   stop-word removal, abbreviation + phrase-synonym expansion, and a conservative
   two-sided-overlap fuzzy fallback.
2. **Tool-calling companion coach** (`ai/companion_setup.py`, mounted at
   `/api/companion`) — derives its tools from gym's *own* OpenAPI via
   `EXPOSE`/`EXCLUDE` allowlists, calls back into the API over loopback
   (`self_base_url`), forwards the caller's JWT, and gates writes behind
   `write_policy="confirm"`. Grounded in the athlete profile + recent training.

**Provider selection is bring-your-own, with no silent default.** Each user
configures Ollama (self-hosted) or Claude (API key) in their `Settings`.
`_provider_configured` is the single source of truth for "usable"; if the chosen
provider isn't set up, the endpoint raises (→ a clear 503-style error) rather than
falling back. Keys are write-only — accepted by PATCH `/settings`, never returned.

## Key decisions

- **No Alembic (yet).** `init_db()` runs `create_all()` for new tables;
  `_ensure_columns()` in `db.py` ALTERs new *columns* onto existing tables from an
  idempotent `_ADDED_COLUMNS` list. Cheap and good enough for a single-file SQLite
  DB; revisit if the schema churn or a Postgres move demands it. (See HOWTO →
  "Add a database column".)
- **SQLite, one file, backed up.** State lives under `state/gym-app/` and rides
  the nightly homelab backup. Postgres is a later option, not a starting cost.
- **BYO AI provider, no silent default** (above) — a privacy + cost stance: the
  homelab runs local Ollama at zero marginal cost; Claude is opt-in per user.
- **Snapshot targets onto sessions** — a logged session copies the plan workout's
  targets, so history is immutable intent, decoupled from a mutable plan.
- **Offline-first writes, made replay-safe.** The client queues writes locally
  and auto-syncs (`frontend/src/lib/offline.ts`); the backend stays a plain REST
  API. Sets are queued unconditionally (they're what you can't lose); finishing,
  swapping and add/remove try the network first and fall back only on a real
  connectivity failure (`ApiError` status 0), never on a 4xx.
  A retry is not always a first attempt — the server may have committed before
  the response was lost — so replayable writes carry an `Idempotency-Key` and
  `app/idempotency.py` returns the first response instead of doing the work
  twice. Without it a replayed start trips the single-active-session guard and
  closes the workout being logged. Only successes are remembered: a rejected
  write has to stay retryable.
- **Derive, don't store, what the sets already say.** Personal records
  (`/stats/summary`) and the progression nudge (`cleared_rep_range`, a Pydantic
  `computed_field` on `SessionExerciseOut`) are computed at serialize time. A
  computed field costs no route changes and can't drift from the sets it
  describes — the trade is that it reflects the *server's* copy, so a set logged
  offline moves the nudge only once the queue drains.
- **A user's data never edits the shared catalog.** Imports create custom
  exercises rather than rewriting global rows, and an uploaded exercise image is
  allowed only on an exercise you own. `GET /auth/me/export` mirrors what
  `DELETE /auth/me` sweeps, so the pair is symmetric: anything the account owns,
  you can take with you before you delete it.
- **companion over SSH** — the private dependency is fetched with an SSH deploy
  key across local/CI/Docker (see HOWTO), not an HTTPS token.
- **Times are naive UTC on the server; calendar days belong to the client.** No
  per-user timezone is stored anywhere, and the API serializes timestamps with no
  `Z` designator. Three consequences, each of which has already caused a bug:
  1. The app must parse API timestamps through `parseServerDate()`
     (`frontend/src/lib/format.ts`) — a bare `new Date(iso)` reads them as *local*
     and shifts every displayed time by the UTC offset.
  2. Endpoints that bucket rows into days take a `tz_offset` query param
     (JS `getTimezoneOffset()`, minutes to add to local to reach UTC), e.g.
     `/splits/catchup`. Bucketing by UTC date files an evening session under the
     next day for anyone west of UTC.
  3. The AI never resolves a date. `parse-days` echoes the day header verbatim
     ("Thu - Push") and the client resolves it against the device calendar
     (`frontend/src/lib/day-label.ts`).

## Frontend (brief)

Expo (Expo Router) + React Native + TypeScript, NativeWind for styling, one
codebase → iOS/Android and a static web bundle served by nginx (`gym-web`).
`src/app/` is the router tree (tabs: Home / Workouts / Exercises / History /
Coach / Settings); `src/api/` wraps the REST client; `src/state/` holds auth, settings,
and live-workout context; `src/lib/` holds offline queue, export, formatting.

## Deploy

Traefik routes `https://${GYM_DOMAIN}/api` → `gym-api` (router priority 100, so it
beats the web catch-all) and `https://${GYM_DOMAIN}/` → `gym-web`, both behind
`local-only@file`. The API build fetches `companion` via a BuildKit SSH-key
secret. See `HOWTO.md` → Deploy.
