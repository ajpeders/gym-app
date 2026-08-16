# gym-app — Roadmap

> AI-assisted gym tracker. Log workouts, track progress, and get coaching from
> a local (Ollama) or frontier (Claude) model. Native-first (Expo / React
> Native) with a web build from the same codebase.

Status: **Phase 0–2 shipped; Phase 3 (AI) largely done; Phase 4 (insights) started; prepping for launch** · Last updated: 2026-08-16

## Launch scope (what "done" means for v1)

Everything below this section is either shipped or deliberately after launch.
Written down because a roadmap with 27 open boxes reads as 27 unfinished jobs,
and most of them are not: they are the product's next two years, not its
release blockers.

**In scope, and done.** Logging (plan, session, sets, rest, swaps, timed and
bodyweight movements), splits in both weekday and rotation form, catch-up,
import from pasted text, the exercise catalog with per-user custom exercises and
photos, history and stats, nutrition v0, athlete profile, the tool-calling
Spotter with bring-your-own model, accounts with onboarding, data export and
delete, client error reporting, and offline-first logging including *starting* a
workout with no signal. Tested by 213 API tests, the frontend unit suite, and 27
end-to-end journeys through the real stack, all three in CI.

**In scope, needs a human.** The EAS build: `eas login` and `eas init` are
interactive and `eas init` writes `extra.eas.projectId`. Config and docs are
ready; no build has been run, so it stays unproven until Alex runs one. This is
the only launch-blocking item left, and it cannot be done from here.

**Deliberately after launch.** Everything still `[ ]` below. Three groups:
*depth* (muscle-volume analysis, e1RM/plateau metrics, charts, PRs and
achievements, plate and 1RM calculators, preset splits, a food database),
*reach* (voice, Siri/App Intents, push notifications, OAuth login, Apple
Health, on-device models, an admin page), and the *Tier-3 bets* the Moats
section already says not to fund yet (camera form-check, wearable fusion,
self-hostable ecosystem). None of them block someone tracking their training
today; several would be actively wrong to ship half-built.

**Known limits, accepted for v1.** No conflict resolution if the same session is
edited on two devices at once (last write wins). 338 of 828 catalog rows have no
image. Import retry creates a second split rather than reconciling. Adding a
*new* exercise offline queues but shows nothing until it syncs — the plan's own
exercises are all there, so this only bites mid-session improvisation with no
signal.

---

> Reconciled against the codebase on 2026-08-14. Deviations from the original plan
> now in reality: **Alembic was dropped** for hand-rolled additive column
> migrations (`api/app/db.py` `_ADDED_COLUMNS`); and the plan model settled as
> **Split** (a week) → **Workout** (a plan-day, scheduled via `weekdays`+`floating`)
> → exercises, with a logged bout called a **Session** (see Data model below).

---

## Vision

A personal strength-training tracker that feels great on the phone *during* a
workout (fast set logging, rest timers, quick-action buttons) and gets smarter
over time via a pluggable AI layer — natural-language logging, progress
analysis, workout generation, and a form/exercise Q&A coach. Everything runs in
the homelab; AI defaults to local Ollama and can flip to Claude per request.

## Moats / Defensibility (north star)

The model is never the moat — anyone can call an LLM. Durable advantage comes from
accumulated context, cost structure, and data asymmetry.
**Thesis: easy to enter, learned-in to stay, and an AI you can afford to run constantly
because it's yours.** Tracking is table stakes; the companion is the product.

**Adaptive depth — serves beginner → advanced.** One engine, different surface: a novice
sees "here's how to do an RDL, you skipped legs"; a bodybuilder sees "back at MAV, rear
delts undertrained, quad:ham 3:1 — add face pulls." The level is known via athlete memory,
so the app grows from your first workout to your 1000th instead of picking a lane (Hevy =
simple, RP/Dr. Muscle = hardcore-only).

Building deliberately:
- **Athlete memory (Tier 1).** A persistent per-user profile the AI reads + writes every
  session — injuries, what cues landed, RPE→weight calibration, equipment, preferences,
  goals. Compounds daily; a competitor can't replicate it on day one.
- **Lavish local compute (Tier 1).** Zero marginal AI cost (homelab Ollama / on-device)
  lets us run AI generously — regenerate UI per set, coach continuously, re-plan every
  session — an experience SaaS unit economics can't match. Privacy is the trust half of
  the same advantage.
- **Import anything (#3).** Trivial to bring a whole training life IN — Notes text (done),
  Hevy/Strong CSV, a photo of a gym whiteboard, a PDF coach program. Easy-in + memory =
  asymmetric switching costs (cheap to enter, costly to leave).
- **Personal calibration + recovery (#4).** Every set sharpens predictions *for you* (true
  working weights, recovery rate, form quirks); infer readiness from in-app usage timing
  (inter-session gaps, per-muscle last-trained) to gate volume/intensity.
- **Voice companion (#5).** Speak to the AI, not just type — a spoken pre-session check-in
  that updates the profile ("shoulder's tight, going lighter today") and hands-free logging
  mid-set. On-device speech keeps it private + low-latency.

Tier-3 bets (roadmap'd, not now): camera form-check (CV/pose), wearable/recovery fusion,
open/self-hostable homelab-native ecosystem.

Not moats — don't over-invest: the public exercise DB, the tracker UI, generic AI chat,
one-shot generated programs.

## Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| App (mobile + web) | **Expo (Expo Router) + React Native + TypeScript** | `react-native-web` for the web build; one codebase → iOS/Android/web |
| Styling | **NativeWind** (Tailwind for RN) | keeps the Tailwind muscle memory from your other apps |
| Backend | **Python FastAPI** + SQLAlchemy (~~Alembic~~ → hand-rolled additive migrations) | matches docuAI/discordbot AI-app pattern; Alembic deferred — `db.py` ALTERs new columns in idempotently |
| DB | **SQLite** to start → Postgres if needed | lives in `state/gym-app/`, covered by homelab backup |
| AI | **Provider abstraction**: Ollama (default) ⇄ Claude (toggle) ⇄ **on-device** | Ollama at `192.168.0.40:11434` / `.47`; Claude via API key; on-device on capable phones (Core ML / `llama.rn` / ExecuTorch) — fully private, no signal needed |
| Exercise data | **free-exercise-db** (~870 exercises + images, public domain) | seeded into our DB at first boot |
| Auth | Bearer/JWT token (single or few users) | defence-in-depth behind Traefik `local-only@file` |
| Deploy | `services/gym-app` → `include` `apps/gym-app/docker-compose.yml` | `api` + `web` containers, Traefik TLS, state volume |

## Architecture (sketch)

```
Expo app (iOS / Android / web)
        │  HTTPS (JWT)
        ▼
FastAPI  ──►  SQLite (workouts, exercises, sessions, metrics)
   │
   └─► AI provider layer ──► Ollama (local, default)
                         └─► Claude API (toggle)
   └─► exercise seed (free-exercise-db) + image assets
```

Repo layout (own git repo under `apps/gym-app/`, gitignored by homelab):

```
gym-app/
  api/                 # FastAPI backend (Dockerfile)
    app/
      models.py        # SQLAlchemy models (single module)
      schemas.py       # Pydantic DTOs
      routes/          # REST endpoints (one router per resource)
      ai/              # domain schemas + prompts + companion wiring (provider seam lives in `companion`)
      seed/            # exercise DB importer
    tests/             # pytest (auth, workouts, exercises)
  frontend/            # Expo / React Native source (Dockerfile builds web)
    src/{app,components,api,state,lib,hooks}
  docker-compose.yml   # api + web services, Traefik labels
  ROADMAP.md
```

---

## Data model (as built — see `api/app/models.py`)

- **exercise** — name, category, primary/secondary muscles, equipment, instructions, images, is_custom, **tracking_type** (weight_reps / bodyweight / time)
- **split** (a week, Sun–Sat) → **workout** (a plan-day; `weekdays` list 0=Sun..6=Sat + `floating`) → **workout_exercise** (ordered, target sets / rep-range / weight / rest) — *the PLAN*
- **session** (a logged bout; `source_workout_id`) → **session_exercise** (snapshots the plan workout's targets) → **sets** (reps, weight, RPE, duration_seconds, type, completed_at, notes) — *the LOG*
- **body_metric** — bodyweight + measurements over time
- **user** + **settings** (units kg/lb, per-user Ollama/Claude config, feature flags)
- **coach_message** — per-user coach chat history for context
- **athlete_profile** — persistent per-user memory the AI reads + writes (experience, goals, injuries, equipment, preferences, durable notes, transient session_note); the companion's backbone (the Tier-1 moat)
- **progress_photo** — per-user photos with a backdatable `taken_at` (EXIF-derived)

*Scheduling lives on the workout* (`weekdays` + `floating`) — the old `schedule_day` table and `routine.day_label` were removed in the split/workout redesign.

*Not separate tables (diverged from the first cut):* live **session** state lives client-side (`state/active-workout.tsx`); **personal records** are derived on the fly in `/stats/summary`, not stored.

---

## Roadmap

`[ ]` = not started · `[x]` = shipped · `[~]` = partial (see note). Phases are ordered; later phases assume earlier ones.

### Phase 0 — Foundation ✅
- [x] `git init` the app repo; scaffold Expo (Expo Router + TS + NativeWind)
- [x] Scaffold FastAPI + SQLAlchemy + SQLite *(Alembic dropped — hand-rolled additive migrations in `db.py`)*
- [x] Auth (token/JWT) + settings model
- [x] `services/gym-app` compose + Traefik wiring + `state/gym-app` volume
- [x] Import **free-exercise-db** → exercise catalog (+ images) *(`app/seed/`)*
- [x] Dev workflow: run api + Expo locally; CI *(`.forgejo/ci.yml`: `py_compile` + `tsc --noEmit`; pytest not yet wired into CI)*

### Phase 1 — Core tracking (MVP) ✅
- [x] Browse / search / filter exercises (by muscle, equipment, category)
- [x] Exercise detail (instructions, images); create custom exercises
- [x] Log a workout: add exercises, log sets (reps / weight / RPE / set type) *(+ `tracking_type`: weight_reps / bodyweight / time)*
- [x] Workout history + view/edit past workouts *(incl. one-shot `/workouts/log` for already-done sessions)*
- [x] Routines/templates: build reusable plans, start a workout from one *(targets snapshotted onto the workout)*
- [x] **User-defined routines**: create/edit/duplicate, import (paste text or pick a template); **Splits** group day-routines into a weekly plan
- [x] **Split/workout redesign shipped** *(2026-07-26)* — Split = the week, Workout = one plan-day, Session = a logged bout. Weekday scheduling now lives on the workout (`weekdays` list + a `floating` "do anytime" flag), edited via the workout editor's WeekdayPicker; the split screen renders the week grid + an "Anytime" section.
- [~] **Import anything** (moat #3): notes-app text → routines ✅ (`/api/ai/parse-routine`); **next: Hevy/Strong CSV, whiteboard photo (vision), PDF coach program**
- [x] Units (kg/lb), basic settings screen
- [x] **Bottom nav tabs restored** — Home / Workouts / Routines / Coach / Settings (Exercises reachable as a route, hidden from the bar)

### Phase 2 — Live workout mode ✅ (mostly)
- [x] Start session (blank or from routine); active-session screen *(`workout/active/[id]`)*
- [x] **Quick-action set buttons** (auto-fill from last session) — toggleable via `feature_flags.quick_buttons`
- [ ] Rest timer + supersets — *live timer UI, `use-rest-timer` hook, and the `rest_timer_default` setting removed 2026-07-26 at user request; per-routine `rest_seconds` (planned rest) kept. Local notifications never built (no `expo-notifications` dep).*
- [x] Inline progress (this session vs last); session summary on finish
- [ ] **Contextual AI prompts during the set** (e.g. nudge, form cue) — toggleable; `feature_flags.in_set_prompts` defaults off, not yet wired

### Phase 3 — AI provider layer + natural-language logging (largely done)
- [x] Provider abstraction: Ollama ⇄ Claude ⇄ ChatGPT/OpenAI; pick provider/model in settings *(BYO per-user, no silent default; `/ai/providers`,`/models`,`/test`). OpenAI shipped 2026-08-16 via the existing companion OpenAI-compatible provider, with per-user write-only API keys and `gpt-5.6` as the default API model.*
- [ ] **On-device AI — iPhone first** (capable phones): run a small model directly on the phone's hardware (iOS: Apple Foundation Models / MLX / Core ML; Android: `llama.rn` / ExecuTorch) — fully private, works offline with no Ollama/Claude needed. Auto-detect support and offer it as a third provider alongside Ollama/Claude. The ultimate "no-setup, no-cost, no-network" local option.
- [x] **Admin page** *(2026-08-16)* — `user.role` plus `GYM_ADMIN_EMAIL` as the
      bootstrap for an install with no admin yet (otherwise granting the first
      one means editing SQLite in the container by hand, which is the problem
      this page exists to remove). `require_admin` 403s a signed-in non-admin
      and leaves the 401 to `get_current_user`, because sending someone to a
      login screen that won't help is worse than saying no.
      All four things it was for:
      - **Crash reports** are now stored (`client_error`) as well as logged, and
        listed newest-first. Reading them used to need shell access, so nobody
        did. A report from a signed-out client is kept — the login screen can
        crash too.
      - **AI health** — every call to `/api/ai/*` and `/api/companion/*` is
        recorded with provider, model, outcome and latency by one middleware
        rather than a dozen instrumented call sites, and the view shows
        per-provider success plus the recent calls. This is the screen that
        would have made "Ollama returns 400" a glance instead of an afternoon.
      - **Accounts** — who exists, how much they train, when they last did, and
        a password reset. Never what they lifted: the operator view is
        aggregate and operational data, which the tests assert field by field.
        An admin can't delete their own account from here.
      - **DB / catalog state** — row counts, custom exercises, and how many
        catalog rows still have no image.
      Entry point appears in Settings only for an admin (`is_admin` on
      `/auth/me`), and the API enforces it regardless.

- [x] **Rolling / cycle-based splits** — `split.mode` = `rigid | rolling`, an
      explicit choice on the plan rather than something faked with `floating` on
      every day, because it changes what today, missed and done each mean.
      **Rigid** is unchanged: weekdays schedule the plan, a passed day is a
      makeup, "done" resets weekly. **Rolling** is an ordered rotation with no
      dates — `/splits/today` returns the whole rotation with `up_next` on
      wherever the log has got to, nothing is ever `missed`, and
      `done_this_cycle` replaces the weekly flag so a cycle that drifts across
      Sunday stays intact. `/splits/catchup` replays the rotation per day
      instead of reading `weekdays`, so the scheduled column no longer goes
      blank. Position is derived from the log every time (`app/rotation.py`),
      never stored, so editing or deleting a session self-corrects it.
      In the app: the split editor picks the mode, the week grid becomes an
      ordered rotation list with reorder arrows and an "Up next" marker, the
      weekday picker disappears from a rolling day's editor, and Home says
      "next in rotation". Existing splits migrated to `rigid` via the column
      default; switching either way is one tap. The coach skill file knows the
      modes so "push/pull/legs, rest whenever" creates a rolling split.
      *Shipped 2026-08-16, raised 2026-08-14 by Alex moving to a rolling split
      because his rest days are unpredictable — the common case, not an edge one.*
- [x] **Preset splits (well-known programs) as a shared library** *(2026-08-16)* —
      seven programs ship as data (`api/app/presets.py`): PPL, Upper/Lower,
      Full Body 3x, Starting Strength, StrongLifts 5x5, Arnold, and a body-part
      split. `GET /api/splits/presets` lists them; `POST
      /api/splits/presets/{slug}/adopt` copies one in.
      **Both consumers, as intended.** The athlete taps *Browse programs* on
      Splits — the answer to a new account's empty screen. The spotter has the
      same two tools and its skill file now tells it to adopt a preset rather
      than hand-build a program it wasn't asked for in detail.
      Movements are named in English and resolved at adopt time by the same
      matcher the importer uses — hard-coded catalog ids would break on the next
      reseed. A test pins every preset name against the real 828-row catalog
      (skipped where that database isn't present), because the in-test catalog
      would happily hide a program naming a lift that doesn't exist. Anything
      unmatched is reported to the user, not dropped: a program missing two of
      its lifts is not the program.
      Copy on adopt, never a live link. Adopting with no plan makes it active;
      adopting while mid-program does not, because browsing the shelf must not
      switch what you're training. Programs that are cycles (PPL, 5x5, Starting
      Strength) adopt as `rolling` rather than having weekdays invented for them.

- [x] **Stop the AI hand-building log payloads** *(2026-08-16)* — the spotter no longer sees the raw
      `POST /sessions/log` payload tool. It sees `POST /sessions/log-text`,
      which routes the phrase through the parser/matcher so NxM expansion,
      catalog id resolution, and "no invented date" stay deterministic. The
      companion manifest test asserts `log-text` is exposed and raw `log` is not.
      Earlier context: the spotter used to construct
      `POST /sessions/log` JSON itself, and it guesses `exercise_id`. Measured
      2026-08-14 against both local models: "log 3x5 squats at 100kg" produced
      `exercise_id: 1` — "Step Jack", the first row of the catalog — because it
      never calls the exercise search tool. Skill guidance got set expansion
      right (3x5 → three sets) but did NOT stop the id guessing, so this needs a
      structural fix rather than more prompt words.
      The app already has the correct pipeline: `/ai/parse` + `_match`, which
      expands NxM and resolves names against the catalog with the matcher that
      has its own test suite. Give the spotter a single "log this text" tool
      that routes the raw phrase through it, so the model's only job is
      recognising a log request — narrow and checkable — instead of authoring
      training data. Same argument as the progression nudge: deterministic where
      it matters, model only at the edges.
- [x] **Recommend the right local model** *(shipped 2026-08-16 — `POST
      /api/ai/check-model` probes the selected model and the picker reports what
      it can actually do, rather than pattern-matching names)* — a homelab Ollama holds a jumble
      (coder models, embedding models, roleplay finetunes, vision models), and
      nothing tells you which are any good for *this* app. Two different
      requirements: the **coach** needs tool calling, and **parsing** needs
      reliable structured JSON output. Rank and badge the user's own installed
      models against both — "recommended", "parsing only", "not suitable" —
      ideally by probing capability rather than pattern-matching names, and
      suggest a `ollama pull` when nothing installed is a good fit.
      *Prompted by hitting it live: selecting `gemma3:27b` made the coach fail
      with a bare "ollama returned HTTP 400" because Gemma can't tool-call. The
      stopgap shipped 2026-08-14 is a `No tool calling` badge in the picker plus
      an error that names the model and the fix (`lib/ai-errors.ts`); the real
      feature is ranking, not a hardcoded deny-list.*
      **Measured 2026-08-14** by running the same scripted conversation at both
      installed models, which is what makes this worth building — the gap is
      large and invisible from the model name alone:
      | | `qwen2.5:7b-instruct` | `qwen3:8b` |
      |---|---|---|
      | Looks up today's plan instead of asking | ✗ | ✓ |
      | Asks for a name instead of inventing one | ✗ (invented "Upper Body Focus") | ✓ |
      | Keeps made-up fields out of the payload | ✗ (`rules: ["monday"...]`) | ✓ |
      | Expands `3x5` into three sets | ✗ | ✓ |
      | Looks up the exercise id | ✗ | ✗ |
      So: **don't ship a static list of blessed names** — rank against a real
      probe (below). Pair it with a suggested `ollama pull` when nothing the
      user has installed scores well.
- [x] **"Check this model" button** — *shipped 2026-08-16.* Settings now calls
      `POST /api/ai/check-model`, which runs a safe fake-tool probe against the
      active provider/model and never writes user data. It scores the exact
      observed failure modes: tool calling, catalog lookup before ids, `3x5`
      set expansion, and argument discipline. The UI reports a verdict
      (`recommended`, `parsing_only`, `not_suitable`) plus per-check details.
      This is the concrete shippable half of the broader model-recommendation
      work; badges/ranking across the whole installed Ollama list remain open.
- [~] **Bring-your-own-model setup guide** (self-hosted / remote Ollama): backend building blocks exist — `/ai/models` (list + pick), `/ai/test` (round-trip), URL normalization — and the `use-ai-status` hook; **the guided onboarding checklist UI itself is still pending**.
- [x] **Natural-language logging**: "bench 3x8 @60kg, felt easy" → structured sets *(built)*
- [x] **Notes → a past day's log**: paste a whole day from a notes app on "Add a past session" and the parser prefills the editable set rows, so an AI-read log can be backdated *(`components/NotesToSets.tsx`; the set-parse prompt handles day headers, one-exercise-per-line, and per-set "weight reps" pairs like `95 10, 90 11`)*
- [x] **Catch up on a backlog** *(2026-08-03)* — `GET /splits/catchup` returns the last 14 days with what the split scheduled against what was logged, bucketed in the client's timezone via a `tz_offset` param (the server stores naive UTC and knows no per-user zone). The Catch up screen lists the gaps; tapping one opens the log screen prefilled with that plan day's exercises and date. Backfilled sessions now carry `source_workout_id`, so making up a day finally retires its `missed` flag on `/splits/today`.
- [x] **Swap an exercise, keep the sets** *(2026-08-03)* — `PATCH /sessions/{id}/exercises/{se_id}` repoints a logged row at a different movement without touching its sets or order, for the machine-was-taken case. Available live (swap button on the exercise card) and on a past session, which gained an edit mode (swap / add / remove) — it was read-only before.
- [x] **Paste several days at once** — `POST /ai/parse-days` splits a multi-day paste on day headers and returns each day's matched sets with the header echoed verbatim; the client resolves "Thursday"/"Jul 30" against the device calendar (`lib/day-label.ts`) and writes one backdated session per day.
- [x] **Routine import from notes**: paste a multi-day program → structured routines *(built)*
- [ ] **Voice companion** (moat #5): speak to the AI, not just type — voice → NL logging, and a spoken pre-session check-in that updates the athlete profile ("shoulder's tight, going lighter"); on-device speech where available
- [ ] **Siri / App Intents (iOS)** (moat #5): "Hey Siri, tell my coach my shoulder's tight" / "Hey Siri, log bench 3x8 @60" → hands-free check-in + logging without opening the app, via App Intents + Shortcuts (needs an EAS dev/native build — not available in Expo Go)
- [~] Robustness: Pydantic schema validation ✅, per-request `latency_ms` display ✅, no-silent-default errors ✅; **automatic output repair loop + provider fallback still basic**
- [x] **Exercise→catalog matching v2**: stemming, stopwords, phrase synonyms (chest press → bench press) + abbreviation expansion (db/bb/ohp/rdl) and a conservative two-sided-overlap fallback *(`ai/service.py` `_stem`/`_match`)*
- [x] **Tool-calling companion coach**: `companion` package mounted at `/api/companion` — reads + logs training by calling gym's own API as tools (write-confirm gate), grounded in athlete profile + history *(added since last plan)*

### Shipped 2026-07 (beyond the phase lists)

- **Splits** — a weekly plan that owns its day-routines plus the weekly schedule
  and progression rules; Home picks today's day from that schedule.
- **Offline-first set logging** — sets are written to the device before the
  network, shown immediately, and auto-synced the moment connectivity returns
  (NetInfo + foreground + backstop timer). Survives app restarts and API
  redeploys; the workout screen renders from cache when offline.
- **Per-movement logging** — exercises carry a tracking type (weight×reps /
  bodyweight / timed), inferred from equipment + name; planks and dead hangs
  log seconds, bodyweight moves lead with reps and treat load as optional.
- **Rep ranges** (8–12) end to end, **per-set notes**, and true **set
  timestamps** (client-supplied so offline sessions keep real times).
- **Catalog migrated to wger** (~850 exercises, muscles/categories/multilingual)
  with data *and* images mirrored into our own storage — no runtime dependency
  on wger, covered by the nightly backup.
- **Progress photos** — camera/library, EXIF-dated, gallery + viewer.
- **Export** a split or workout as readable text or JSON via the share sheet.
- **Log a completed workout** after the fact, and backdate live sessions.
- **Personal-trainer coach voice** shared by both coach surfaces.

### Launch prep — open items (from 2026-07 user testing)

Found while actually training with the app. Ordered by how much they hurt.

- [x] **Import quality** — *resolved 2026-08-13.* Re-verified by re-importing the
      same real 7-day plan live against local qwen3:8b. The parse half was
      already fixed by the 2026-07-30 schema/prompt work: sets survive on all 38
      exercises, nothing vanishes, abs no longer collapse to "Plank", and all 10
      progression rules come through. The *matching* half was still broken, and
      is now fixed in `_match`: a `_contradicts` guard rejects a candidate that
      names a conflicting angle (flat vs decline), equipment (dumbbell vs
      machine), movement (extension vs crunch) or body part (bench vs shoulder);
      unrequested equipment demotes a candidate; and overlap is scored as a
      fraction of both names, so a one-token subset ("Row") no longer beats a
      strong partial ("One Arm Bent Row"). Held movements also get their seconds
      moved out of the rep fields deterministically. Pinned by
      `tests/test_ai_matching_wger.py` — note `test_ai_matching.py` pins the
      *free-exercise-db* names, which is why it stayed green while live imports
      drifted; the served catalog is wger.
      **Left over, and not a matcher bug:** wger has no cable face pull and no
      unqualified lat pulldown, so those two land on the nearest variant. That's
      a catalog gap — the custom-exercise path below is the answer.
- [~] **Import your own workout** — the pasted-text path is **built**:
      `workout-import.tsx` parses, shows a review step with per-day and
      per-exercise checkboxes plus editable set/rep/weight drafts, and creates
      user-owned custom exercises (deduped by name within a run) for anything
      unmatched, so the shared catalog is never altered. **Still to do:**
      CSV/JSON and app-export (Hevy/Strong) input, and making a retry safe —
      re-running an import today creates a second split rather than reconciling.
- [x] **Duplicate in-progress workouts** — *resolved 2026-08-03.* At most one
      session may be open: `POST /sessions/start` finishes any stray (stamping it
      with its own last set, not "now"), and `GET /sessions/active` lets a client
      find one it doesn't remember. Strays are finished, never deleted — the
      offline queue drops a set permanently on a 4xx, so deleting a session another
      device is still syncing to would lose that work. The `useStartSession` hook
      guards every Start button: same day already running resumes silently, a
      different one asks before closing.
- [x] **Terminology cleanup** — *resolved 2026-07-26.* Settled naming shipped
      across backend + frontend: **Split** = the week, **Workout** = one plan-day
      (with `weekdays`/`floating` scheduling), **Session** = a logged bout. The old
      routine/schedule_day vocabulary is gone.
- [x] **Progression nudge** — *shipped 2026-08-13.* The plan's own rule ("hit the
      top of the rep range for all sets → add weight next time") is now said out
      loud. `app/progression.py` holds it as a pure function and
      `SessionExerciseOut` exposes it as a derived `cleared_rep_range` — a
      Pydantic computed field, so every surface that already returns a session
      (live screen, past session, history) gets it without a route change, and
      nothing new is stored. Deliberately strict: every working set must reach
      the top and the planned set count must actually be done, because a nudge
      that fires when you didn't earn it teaches you to ignore it. Warmups, drop
      sets and a set taken to failure don't count against you. Rendered by
      `components/workout/ProgressionNudge.tsx`. Known edge: it is computed on
      the server copy, so a set logged offline surfaces the nudge on sync.
- [~] **Exercise images** — 338 of 828 catalog rows still have no image (40%).
      **Shipped 2026-08-13:** you can give any exercise *you own* a photo —
      `POST/DELETE /exercises/{id}/image`, picker on the exercise detail screen.
      Scoped to your own exercises on purpose: one account must not repaint the
      shared catalog, the same rule the import path follows. It covers the case
      that bites most, since the importer turns every unmatched movement into a
      custom exercise with no picture. Files land in the existing
      `exercise-media` tree so every `<Image>` renders them unchanged.
      **Still open:** the 40% gap on *global* catalog rows, and "that Plank photo
      looks wrong". Needs either a per-user override table (upload against a
      global exercise) or licensed demo GIFs (Gym Visual — paid; the only source
      with true animated GIFs).
- [~] **Offline beyond sets** — *2026-08-13, connectivity did prove flaky.*
      The set queue is now a general write queue: **finishing** a workout,
      **swapping** a taken machine, adding and removing an exercise, and
      removing a set all survive a dead zone. Sets are still queued
      unconditionally (they're what you can't lose); the others try the network
      first and only fall back to the queue on a real connectivity failure
      (`ApiError` status 0), never on a 4xx the server would reject again.
      Finishing stamps the time you tapped it, not the time the queue drained,
      and the server keeps the first finish it sees rather than restamping.
      Underneath it all: `api/app/idempotency.py` + an `Idempotency-Key` header
      on start / add-exercise / add-set, so a write the server committed but
      never got to acknowledge is not done twice. That closes a hole sets always
      had — a replayed start would otherwise trip the single-active-session
      guard and close the workout you're standing in.
      **Starting** a workout offline landed 2026-08-16, which completes this.
      The local session id is never rewritten — that was the trap. It is a
      permanent alias, and the server id is swapped in at the one seam where
      writes are actually sent; the session's exercise rows are joined by
      position when the start syncs, so sets logged before it landed find their
      real rows instead of 404ing and being dropped. The session shown offline
      is built from a plan cached by Home and the split screen, so it opens with
      the same exercises and targets as an online start. Covered end to end
      (`frontend/e2e/03-offline.spec.ts`), including a restart mid-session and a
      double flush that must not open a second session.
- [~] **UI/UX pass** — a deliberate visual + flow review of every screen before
      launch. In progress: the shared dark palette was refreshed 2026-08-16
      from purple-navy to a deeper midnight/aqua system, with softer surfaces,
      a clearer Home "Up next" hero, and more explicit ChatGPT/OpenAI setup
      copy. Remaining work is screen-by-screen interaction polish rather than
      another global palette swing.
- [~] **Launch checklist** — accounts/onboarding for a non-homelab user, EAS
      build + distribution, error reporting, and a data-export/delete story.
  - [x] **Data export / delete** *(2026-08-13)* — `DELETE /auth/me` already
        cascaded; `GET /auth/me/export` is the other half. One JSON document
        with splits, workouts, every session and set, body metrics, nutrition,
        athlete profile, custom exercises and a progress-photo manifest, built
        from the same `*Out` schemas the API already serves so a new field can't
        be silently left behind. The shared catalog is excluded (828 rows nobody
        owns is noise) and nothing secret leaves — no password hash is on any
        `Out` schema and `SettingsOut` omits the Claude/OpenAI keys. Settings → Your data.
  - [x] **Error reporting** *(2026-08-13)* — `POST /api/errors` takes a client
        crash (message, stack, context, platform, version) and writes it to a
        `gym.client` logger, next to the API's own unhandled exceptions, so
        there's one place to look and no new service to run in the homelab.
        `lib/report-error.ts` installs a global RN error handler at startup that
        chains the previous one (so the redbox and fatal handling survive) and
        never throws — the API being down is frequently *why* it crashed.
        Reporting works signed out, because the login screen can crash too.
        A self-hosted Sentry/GlitchTip DSN plugs in behind that one function if
        grouping and stack symbolication are ever wanted.
  - [x] **Accounts / onboarding** *(2026-08-13)* — `app/onboarding.tsx`, shown
        once after registering. One screen, not a wizard: units, bring-your-own
        AI (explicitly optional — a non-homelab user has no Ollama to point at),
        and paste-your-plan. Everything is skippable and nothing blocks reaching
        the app. Gated on `feature_flags.onboarded === false`, which
        registration writes explicitly: accounts predating onboarding have no
        flag at all and are never dragged through a tour of an app they use.
        The flag lives on the account, so a second phone doesn't ask again.
  - [~] **EAS build + distribution** — *config landed 2026-08-13.* `eas.json`
        with development / preview / production profiles, `com.forgo.gymapp` as
        the bundle id on both platforms, and `EXPO_PUBLIC_API_URL` pinned per
        profile (a device build can't reach `localhost:8000`; the value is baked
        in at build time). Steps in HOWTO → "Build the app for a phone (EAS)".
        **Needs a human:** `eas login` + `eas init` are interactive, and
        `eas init` is what writes `extra.eas.projectId` into `app.json`. No
        build has been run, so the config is unproven until you run one.

### Phase 4 — AI insights & coaching (started)
- [~] **Progress analysis**: `/stats/summary` ships streak, weekly volume, and recent PRs (+ a `progress` screen); **plateaus, per-muscle volume, frequency still to do**
- [x] **Muscle coverage & volume analysis** *(2026-08-16)* — `GET /api/stats/muscles?weeks=N` and the Insights screen (History → Insights). Hard sets per muscle over a 1/4/12-week window, primary full credit and secondary half, warmups and drops excluded; every landmark muscle is returned including the untrained ones, because a muscle missing from the list is the one that goes unnoticed. Status against MEV/MAV/MRV reads under / productive / over, plus push:pull and quad:ham ratios (a side with no volume reports "nothing to compare", never infinity). The maths is pure and tested (`app/analysis.py`, `tests/test_analysis.py`); **AI interpretation on top is still open** and deliberately so — the numbers must be counted, not generated.
- [~] **Advanced metrics** — **e1RM trends and tonnage shipped 2026-08-16** (`GET /api/stats/exercises/{id}/trend`: Epley per session day from the top set, direction up/down/flat with a 2% threshold so noise isn't read as progress, total tonnage). Double progression already drives the nudge and the next-session targets. **Still open:** rep-PRs, RIR/RPE autoregulation, periodization/deload tracking
- [~] Charts/dashboard — weekly tonnage bars and per-muscle volume bars on the Insights screen (plain Views; a charting library is a lot of bundle for eight bars). **Est-1RM and body-metric charts still to draw** — the trend data is already served.
- [ ] **Workout generation** from goals + equipment + recent fatigue
- [ ] **AI-generated routines**: generate a full multi-day routine/program from goals + experience level + available equipment + weekly schedule (and athlete memory once present) → saved as normal editable routines. The inverse of Import (bring a plan *in* ↔ generate one *out*); reuses the same routine/exercise-catalog-matching pipeline so generated exercises resolve to the real catalog. Keep it **editable + regenerable, not one-shot** — one-shot programs aren't a moat (line "Not moats"); the defensibility comes from regenerating against *your* logged history, calibration, and recovery signal
- [x] **Progressive-overload suggestions for the next session** *(2026-08-16)* — `GET /api/workouts/{id}/suggestions` and the "Next time" card on Insights. Same rule as the progression badge (`app/overload.py` beside `app/progression.py`), so the two can never disagree: clear the top of the rep range on every working set and the weight goes up, by an increment that matches the equipment — 2.5kg barbell, 4kg dumbbell pair, 5kg machine stack, because advice you can't follow is worse than none. Bodyweight adds a rep, timed holds add five seconds, and the baseline is the heaviest working set rather than the last one. Deterministic throughout: a suggested weight is training data, and an invented one is worse than nothing.
- [ ] **Form / exercise Q&A** chat coach (RAG over exercise DB)
- [x] **Athlete memory** (Tier-1 moat): `athlete_profile` model + `/ai/check-in` (NL → profile) + `/profile` CRUD; injected into every coach/parse prompt via `profile_summary`. *(Calibration/recovery signals below still to layer on.)*
- [ ] **Personal calibration flywheel** (moat #4): per-user adaptive weight/RPE predictions that sharpen with each logged set
- [ ] **Recovery from usage** (moat #4): infer readiness from in-app timing (inter-session gaps, per-muscle last-trained) to gate volume/intensity
- [ ] **Lavish AI** (Tier-1 moat): regenerate in-session UI / re-plan per session without rationing — free on local compute

### Phase 5 — Polish & power features
- [~] **Nutrition logging** — lightweight v0 exists, v1 is now specified in
      `docs/superpowers/specs/2026-07-27-calorie-protein-tracker-design.md`.
      **Today:** `nutrition_entry` stores `label`, `calories`, `protein`, and
      timestamp `eaten_at`; CRUD lives at `/api/nutrition`; AI parsing lives at
      `/ai/parse-nutrition`; the app has a Nutrition screen and a Home card.
      The client currently groups entries by local calendar day because the
      server has no per-user timezone and server grouping would impose UTC day
      boundaries.
      **Target v1:** make nutrition explicitly day-based and goal-based without
      becoming a full meal-planning app: `NutritionGoal` history, `NutritionEntry`
      with `local_date` + meal bucket, `SavedFood`, daily and Sunday-through-
      Saturday summaries, and Home/calendar/profile integration with editable
      calorie + protein targets. Manual logging and saved foods come before AI
      smart input; AI must always produce an editable review, never silent writes.
      **Migration decision:** evolve the current timestamped entries carefully
      rather than layering a second incompatible model beside them. Existing
      `eaten_at` rows can backfill `local_date` using the device/local timezone
      assumption that the current client already uses.
- [x] **Food database with default calories / protein** *(2026-08-16)* — ~70 staples ship as data (`api/app/foods.py`), searchable at `GET /api/nutrition/foods?q=`, and `POST /api/nutrition` now accepts `{food, amount}` and fills in the macros server-side. Curated and small on purpose: the staples are most of what a lifter logs, and the long tail of packaged products is a lookup problem (barcodes, a real food API), not a bigger list. What you type still wins over the shelf — a weighed portion or a label you read yourself is never overwritten — and an unknown food is a 404 rather than an entry logged as zero calories, which would silently make the day's totals wrong. Nutrition screen gets a search-and-amount picker.
      Today every entry is
      typed from scratch: a free-text label and two numbers you have to know or
      guess. Give it a searchable food library so "chicken breast, 200g" fills
      itself in.
      Worth deciding up front:
      - **Where the data comes from.** USDA FoodData Central is public domain
        and the obvious seed (same play as the exercise catalog: mirror it into
        our own storage, no runtime dependency). Open Food Facts adds branded
        and barcoded items under ODbL — check attribution terms first.
      - **Portions are the hard part**, not the numbers. Per-100g is what the
        data ships as; "a chicken breast", "a scoop", "a slice" is how people
        eat. Needs a serving/unit model, not just a calories field.
      - **Your foods beat the database.** Frequently logged and custom items
        (your protein powder, your usual lunch) should rank above the generic
        catalog, and a custom food is user-owned — never an edit to the shared
        library, same rule as custom exercises.
      - **Feeds the AI too.** `/ai/parse-nutrition` currently invents numbers
        from the model's own knowledge; resolving parsed foods against a real
        database makes "chicken and rice" a lookup instead of a guess — the
        same matcher problem the exercise catalog already solved.
- [x] **Coach chat UI redesign** — *shipped 2026-08-16.* The Coach tab was
      reframed as **Spotter** to match its tool-running role, gained a
      persistent top bar, stronger empty state, explicit disclaimer, clearer
      message bubbles, consolidated streaming text, compact activity chips,
      and readable write-confirm cards with a composer lockout while an action
      is pending. Related: the broader **UI/UX pass** in Launch prep.
- [x] PRs, achievements, streaks *(2026-08-16)* — `GET /api/stats/achievements` and a Milestones card on Insights. Derived, never granted: each one restates what the log already says, so none can be earned by anything but training. Ten of them, not sixty — showing up, keeping it up, and lifting more than before. Unearned ones report progress ("7 of 10") rather than showing a padlock, and the streak counted is the *longest* run, because an achievement you lose by resting is a reason not to rest. A PR means beating a weight you had already lifted; the first time you do a movement isn't one, or every new exercise would be.
- [x] Offline-first sync (native): a persisted write queue with retries survives restarts/dead zones (`lib/offline.ts`) — sets, session edits, finishing, and starting a workout. **conflict resolution not yet built**
- [ ] Push notifications (rest done, workout reminders) via ntfy/web-push *(no `expo-notifications` yet)*
- [x] Plate / warmup / 1RM calculators *(2026-08-16)* — `GET /api/tools/{plates,warmup,one-rep-max}` and a Calculators screen (History → Calculators). Plates are greedy heaviest-first, which is both optimal for real plate sets and the order you physically load them; a target the plates can't make reports the nearest one and how much you're short rather than failing. Warmups ramp from the empty bar on weights that are actually loadable, and stay short for a light working weight. The max estimate shares `analysis.e1rm`, so it can't drift from the strength trend. All pure and tested (`app/calculators.py`) — this is the maths you'd do standing at the bar, and it must not need a network.
- [~] Export/import: text + JSON export via native Share sheet (`lib/export.ts`); **CSV + re-import + backup fold-in still to do**
- [ ] Multi-user profiles (optional)
- [ ] **Social / OAuth login** ("log in with other apps" — Google / Apple / GitHub) via expo-auth-session; optional alongside the existing email/password auth
- [ ] Apple Health / Google Fit + Apple Watch (stretch)

### Tier-3 moat bets (future — bigger builds)
- [ ] **Camera form-check** (CV/pose): on-device pose estimation → real-time technique feedback. Deepest technical moat; separate mountain (accuracy/safety/latency)
- [ ] **Wearable / recovery fusion**: HRV / sleep / readiness from Apple Watch / Whoop / Oura feeding the recovery model (moat #4)
- [ ] **Open / self-hostable**: homelab-native extensibility (MCP-style), self-host tier → community moat (only if personal → product)

### Cross-cutting (ongoing)
- [x] Tests: backend pytest (213, `api/tests/`) ✅, frontend unit tests (vitest, `src/lib/offline.test.ts` — the queue is the one
      place a frontend bug silently loses training) ✅, and an end-to-end suite
      (27 Playwright journeys in `frontend/e2e/`: real web build, real API, real
      SQLite, nothing mocked — auth, the log-a-workout loop, offline start and
      sync, rolling splits, plan management, catch-up, catalog, history/stats,
      onboarding, profile/nutrition, and the AI surfaces with no provider
      configured) ✅. All three run in CI (`.forgejo/workflows/ci.yml`).
      *What e2e caught that unit tests structurally could not: an offline
      restart logging you out, a reconnect not flushing the queue on web, and a
      finished session reappearing as ongoing.*
- [x] Security: auth + per-owner scoping on every route, Pydantic validation, secrets via `GYM_*` env; no published host port (Traefik TLS + `local-only`); JWT-default startup warning
- [~] Observability: `logging` on boot/seed + `latency_ms` on AI calls; **structured logs + full AI request tracing still to do**
- [x] Docs: README ✅, ROADMAP ✅, PROPOSAL ✅, HOWTO ✅, ARCHITECTURE ✅

---

## Open questions
1. **App name** — keep `gym-app` or brand it?
2. **Who uses it** — just you, or a few accounts (changes auth scope)?
3. **Getting it on your phone** — Expo Go for dev, then EAS dev build / sideload, or eventual app-store push?
4. **Default local model** — which Ollama model for parsing/coaching (e.g. `llama3.1`, `qwen2.5`)? Which on-device model/runtime for capable phones?
5. **First milestone to build** — recommend Phase 0 + Phase 1 (a working tracker you can use), then layer AI.
