# gym-app — Roadmap

> AI-assisted gym tracker. Log workouts, track progress, and get coaching from
> a local (Ollama) or frontier (Claude) model. Native-first (Expo / React
> Native) with a web build from the same codebase.

Status: **Phase 0–2 shipped; Phase 3 (AI) largely done; Phase 4 (insights) started; prepping for launch** · Last updated: 2026-07-26

> Reconciled against the codebase on 2026-07-26. Two deviations from the original
> plan are now reality: **Alembic was dropped** for hand-rolled additive column
> migrations (`api/app/db.py` `_ADDED_COLUMNS`), and a **Split** layer (a weekly
> plan owning several day-`Routine`s) was added on top of the model sketch below.

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
- **split** (weekly plan) → **routine** (a day, `day_label`/`day_order`) → **routine_exercise** (ordered, target sets / rep-range / weight / rest)
- **workout** (a logged session) → **workout_exercise** (snapshots the routine targets) → **sets** (reps, weight, RPE, duration_seconds, type, completed_at, notes)
- **body_metric** — bodyweight + measurements over time
- **user** + **settings** (units kg/lb, per-user Ollama/Claude config, feature flags)
- **coach_message** — per-user coach chat history for context
- **athlete_profile** — persistent per-user memory the AI reads + writes (experience, goals, injuries, equipment, preferences, durable notes, transient session_note); the companion's backbone (the Tier-1 moat)
- **schedule_day** — one routine (or rest) per weekday, per user
- **progress_photo** — per-user photos with a backdatable `taken_at` (EXIF-derived)

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
- [x] Provider abstraction: Ollama ⇄ Claude; pick provider/model in settings *(BYO per-user, no silent default; `/ai/providers`,`/models`,`/test`)*
- [ ] **On-device AI — iPhone first** (capable phones): run a small model directly on the phone's hardware (iOS: Apple Foundation Models / MLX / Core ML; Android: `llama.rn` / ExecuTorch) — fully private, works offline with no Ollama/Claude needed. Auto-detect support and offer it as a third provider alongside Ollama/Claude. The ultimate "no-setup, no-cost, no-network" local option.
- [~] **Bring-your-own-model setup guide** (self-hosted / remote Ollama): backend building blocks exist — `/ai/models` (list + pick), `/ai/test` (round-trip), URL normalization — and the `use-ai-status` hook; **the guided onboarding checklist UI itself is still pending**.
- [x] **Natural-language logging**: "bench 3x8 @60kg, felt easy" → structured sets *(built)*
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

- [ ] **Import quality** — the AI routine import drops data: `Sets` are lost on
      almost every exercise, some exercises vanish entirely (Cable Fly, Face
      Pulls, Leg Extension, Rear-Delt Fly), abs work collapses to "Plank", and
      variants get swapped (seated *dumbbell* → *cable* press, *standing* →
      *donkey* calf raise). Rep-ranges + matcher v2 landed since, so a re-import
      would improve — but the dropped-sets and missing-exercise bugs are
      prompt/parse issues that remain. Highest-value fix before anyone else
      imports a plan.
- [ ] **Import your own workout** — let each user bring in a personal workout or
      full split from pasted text, CSV/JSON, or a supported app export. Imported
      plans become user-owned, fully editable routines; unmatched movements are
      created as that user's custom exercises instead of altering the shared
      third-party catalog. Include a review step before saving and make imports
      safe to retry without creating duplicates.
- [ ] **Duplicate in-progress workouts** — starting a workout doesn't detect or
      resume an already-active one, so taps pile up sessions (3 were open during
      testing). Resume-or-prompt on start, and clean up the strays.
- [ ] **Terminology cleanup** — settled meaning is routine = one day, split =
      the week. A few display strings still call a day-routine a "split" (left
      over from the rename that predated the Split model).
- [ ] **Progression nudge** — the plan's own rule is "hit the top of the rep
      range for all sets → add weight next time". The app has the targets and
      the logged reps but says nothing. Flag it when you clear the range.
- [ ] **Exercise images** — ~44% of the wger catalog has no image (free-exercise-db
      backfill got coverage to ~56%). Options: let users upload/replace an image
      per exercise (also fixes "that Plank photo looks wrong"), or license real
      demo GIFs (Gym Visual — paid; the only source with true animated GIFs).
- [ ] **Offline beyond sets** — logged sets are queued and auto-sync, but
      starting/finishing a workout and every other write still needs the
      network. Extend the queue if mid-session connectivity proves flaky.
- [ ] **UI/UX pass** — a deliberate visual + flow review of every screen before
      launch (in progress).
- [ ] **Launch checklist** — accounts/onboarding for a non-homelab user, EAS
      build + distribution, error reporting, and a data-export/delete story.

### Phase 4 — AI insights & coaching (started)
- [~] **Progress analysis**: `/stats/summary` ships streak, weekly volume, and recent PRs (+ a `progress` screen); **plateaus, per-muscle volume, frequency still to do**
- [ ] **Muscle coverage & volume analysis** *(lower priority — pro depth, after the core companion + memory)*: per session + per week, hard sets per muscle (primary = full, secondary = partial credit using the exercise DB's muscle tags), coverage gaps, balance ratios (push/pull, quad/ham), neglected muscles, and volume vs landmarks (MEV/MAV/MRV). Deterministic math; AI interprets + recommends the fix
- [ ] **Advanced metrics** *(lower priority)*: e1RM trends, tonnage, rep-PRs, double progression, RIR/RPE autoregulation, periodization/deload tracking
- [ ] Charts/dashboard (volume over time, est 1RM, body metrics)
- [ ] **Workout generation** from goals + equipment + recent fatigue
- [ ] **AI-generated routines**: generate a full multi-day routine/program from goals + experience level + available equipment + weekly schedule (and athlete memory once present) → saved as normal editable routines. The inverse of Import (bring a plan *in* ↔ generate one *out*); reuses the same routine/exercise-catalog-matching pipeline so generated exercises resolve to the real catalog. Keep it **editable + regenerable, not one-shot** — one-shot programs aren't a moat (line "Not moats"); the defensibility comes from regenerating against *your* logged history, calibration, and recovery signal
- [ ] Progressive-overload suggestions for the next session
- [ ] **Form / exercise Q&A** chat coach (RAG over exercise DB)
- [x] **Athlete memory** (Tier-1 moat): `athlete_profile` model + `/ai/check-in` (NL → profile) + `/profile` CRUD; injected into every coach/parse prompt via `profile_summary`. *(Calibration/recovery signals below still to layer on.)*
- [ ] **Personal calibration flywheel** (moat #4): per-user adaptive weight/RPE predictions that sharpen with each logged set
- [ ] **Recovery from usage** (moat #4): infer readiness from in-app timing (inter-session gaps, per-muscle last-trained) to gate volume/intensity
- [ ] **Lavish AI** (Tier-1 moat): regenerate in-session UI / re-plan per session without rationing — free on local compute

### Phase 5 — Polish & power features
- [ ] PRs, achievements, streaks
- [~] Offline-first sync (native): a persisted set-log queue with retries survives restarts/dead zones (`lib/offline.ts`); **conflict resolution not yet built**
- [ ] Push notifications (rest done, workout reminders) via ntfy/web-push *(no `expo-notifications` yet)*
- [ ] Plate / warmup / 1RM calculators
- [~] Export/import: text + JSON export via native Share sheet (`lib/export.ts`); **CSV + re-import + backup fold-in still to do**
- [ ] Multi-user profiles (optional)
- [ ] **Social / OAuth login** ("log in with other apps" — Google / Apple / GitHub) via expo-auth-session; optional alongside the existing email/password auth
- [ ] Apple Health / Google Fit + Apple Watch (stretch)

### Tier-3 moat bets (future — bigger builds)
- [ ] **Camera form-check** (CV/pose): on-device pose estimation → real-time technique feedback. Deepest technical moat; separate mountain (accuracy/safety/latency)
- [ ] **Wearable / recovery fusion**: HRV / sleep / readiness from Apple Watch / Whoop / Oura feeding the recovery model (moat #4)
- [ ] **Open / self-hostable**: homelab-native extensibility (MCP-style), self-host tier → community moat (only if personal → product)

### Cross-cutting (ongoing)
- [~] Tests: backend pytest (`api/tests/`: auth, workouts, exercises) ✅; **frontend tests + pytest-in-CI still missing**
- [x] Security: auth + per-owner scoping on every route, Pydantic validation, secrets via `GYM_*` env; no published host port (Traefik TLS + `local-only`); JWT-default startup warning
- [~] Observability: `logging` on boot/seed + `latency_ms` on AI calls; **structured logs + full AI request tracing still to do**
- [~] Docs: README ✅, ROADMAP ✅, PROPOSAL ✅, HOWTO ✅; **ARCHITECTURE.md still missing**

---

## Open questions
1. **App name** — keep `gym-app` or brand it?
2. **Who uses it** — just you, or a few accounts (changes auth scope)?
3. **Getting it on your phone** — Expo Go for dev, then EAS dev build / sideload, or eventual app-store push?
4. **Default local model** — which Ollama model for parsing/coaching (e.g. `llama3.1`, `qwen2.5`)? Which on-device model/runtime for capable phones?
5. **First milestone to build** — recommend Phase 0 + Phase 1 (a working tracker you can use), then layer AI.
