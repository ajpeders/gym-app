# gym-app — Roadmap

> AI-assisted gym tracker. Log workouts, track progress, and get coaching from
> a local (Ollama) or frontier (Claude) model. Native-first (Expo / React
> Native) with a web build from the same codebase.

Status: **Phase 0–1 shipped; Phase 3 (AI) in progress** · Last updated: 2026-06-26

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
| Backend | **Python FastAPI** + SQLAlchemy + Alembic | matches docuAI/discordbot AI-app pattern |
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
      models/          # SQLAlchemy models
      routes/          # REST endpoints
      ai/              # provider abstraction (ollama, claude) + prompts
      seed/            # exercise DB importer
  app/                 # Expo / React Native source (Dockerfile builds web)
    src/{screens,components,api,state,styles}
  docker-compose.yml   # api + web services, Traefik labels
  ROADMAP.md
```

---

## Data model (first cut)

- **exercise** — name, category, primary/secondary muscles, equipment, instructions, images, is_custom
- **routine** (template) → **routine_exercise** (ordered, target sets/reps/rest)
- **workout** (a logged session) → **workout_exercise** → **set** (reps, weight, RPE, type: warmup/working/drop, completed_at)
- **session** (live, in-progress workout state: current exercise, timer, flags)
- **body_metric** — bodyweight + measurements over time
- **personal_record** — derived PRs (1RM est, max weight/reps/volume) per exercise
- **user** + **settings** (units kg/lb, AI provider/model, feature toggles)
- **ai_message** — chat/coach history for context
- **athlete_profile** — persistent per-user memory the AI reads + writes (injuries, cue notes that landed, RPE→weight calibration, equipment, goals, preferences); the companion's backbone (the Tier-1 moat)

---

## Roadmap

Checkbox = not started. Phases are ordered; later phases assume earlier ones.

### Phase 0 — Foundation
- [ ] `git init` the app repo; scaffold Expo (Expo Router + TS + NativeWind)
- [ ] Scaffold FastAPI + SQLAlchemy + Alembic + SQLite
- [ ] Auth (token/JWT) + settings model
- [ ] `services/gym-app` compose + Traefik wiring + `state/gym-app` volume
- [ ] Import **free-exercise-db** → exercise catalog (+ images)
- [ ] Dev workflow: run api + Expo locally; CI lint/test (match your Vitest/pytest setup)

### Phase 1 — Core tracking (MVP)
- [ ] Browse / search / filter exercises (by muscle, equipment, category)
- [ ] Exercise detail (instructions, images); create custom exercises
- [ ] Log a workout: add exercises, log sets (reps / weight / RPE / set type)
- [ ] Workout history + view/edit past workouts
- [ ] Routines/templates: build reusable plans, start a workout from one
- [ ] **User-defined routines**: users create their own routines, edit/add-to/duplicate existing ones, and import a routine (paste text or pick a template)
- [ ] **Import anything** (moat #3): notes-app text → routines (✅ built via `/api/ai/parse-routine`); next: Hevy/Strong CSV export, a photo of a gym whiteboard (vision), a PDF coach program
- [ ] Units (kg/lb), basic settings screen
- [ ] **Bottom nav: re-add Workouts / Exercises / Routines as tabs** — trimmed to Home + Settings during early dev; the screens still exist as routes (reachable from Home), just hidden from the tab bar

### Phase 2 — Live workout mode
- [ ] Start session (blank or from routine); active-session screen
- [ ] **Quick-action set buttons** (auto-fill from last session) — *toggleable*
- [ ] Rest timer (per-set) with local notifications; supersets
- [ ] Inline progress (this session vs last); session summary on finish
- [ ] **Contextual AI prompts during the set** (e.g. nudge, form cue) — *toggleable*

### Phase 3 — AI provider layer + natural-language logging
- [ ] Provider abstraction: Ollama default ⇄ Claude; pick provider/model in settings
- [ ] **On-device AI** (capable phones): run a small local model on the phone's hardware (Core ML / `llama.rn` / ExecuTorch) — private, offline; auto-detect support and offer as a provider
- [x] **Natural-language logging**: "bench 3x8 @60kg, felt easy" → structured sets *(built)*
- [x] **Routine import from notes**: paste a multi-day program → structured routines *(built)*
- [ ] **Voice companion** (moat #5): speak to the AI, not just type — voice → NL logging, and a spoken pre-session check-in that updates the athlete profile ("shoulder's tight, going lighter"); on-device speech where available
- [ ] Robustness: validation/repair of model output, fallbacks, cost/latency display
- [ ] **Exercise→catalog matching v2**: stemming (raise/raises) + bidirectional token overlap so "cable triceps pushdown" matches "Triceps Pushdown" (current matcher too strict)

### Phase 4 — AI insights & coaching
- [ ] **Progress analysis**: trends, PRs, plateaus, volume per muscle, frequency
- [ ] **Muscle coverage & volume analysis** *(lower priority — pro depth, after the core companion + memory)*: per session + per week, hard sets per muscle (primary = full, secondary = partial credit using the exercise DB's muscle tags), coverage gaps, balance ratios (push/pull, quad/ham), neglected muscles, and volume vs landmarks (MEV/MAV/MRV). Deterministic math; AI interprets + recommends the fix
- [ ] **Advanced metrics** *(lower priority)*: e1RM trends, tonnage, rep-PRs, double progression, RIR/RPE autoregulation, periodization/deload tracking
- [ ] Charts/dashboard (volume over time, est 1RM, body metrics)
- [ ] **Workout generation** from goals + equipment + recent fatigue
- [ ] Progressive-overload suggestions for the next session
- [ ] **Form / exercise Q&A** chat coach (RAG over exercise DB)
- [ ] **Athlete memory** (Tier-1 moat): per-user `athlete_profile` the AI reads + writes each session (injuries, cues that landed, RPE→weight calibration, equipment, goals) — the companion's backbone
- [ ] **Personal calibration flywheel** (moat #4): per-user adaptive weight/RPE predictions that sharpen with each logged set
- [ ] **Recovery from usage** (moat #4): infer readiness from in-app timing (inter-session gaps, per-muscle last-trained) to gate volume/intensity
- [ ] **Lavish AI** (Tier-1 moat): regenerate in-session UI / re-plan per session without rationing — free on local compute

### Phase 5 — Polish & power features
- [ ] PRs, achievements, streaks
- [ ] Offline-first sync (native) with conflict resolution
- [ ] Push notifications (rest done, workout reminders) via ntfy/web-push
- [ ] Plate / warmup / 1RM calculators
- [ ] Export/import (CSV/JSON); fold into homelab backup
- [ ] Multi-user profiles (optional)
- [ ] **Social / OAuth login** ("log in with other apps" — Google / Apple / GitHub) via expo-auth-session; optional alongside the existing email/password auth
- [ ] Apple Health / Google Fit + Apple Watch (stretch)

### Tier-3 moat bets (future — bigger builds)
- [ ] **Camera form-check** (CV/pose): on-device pose estimation → real-time technique feedback. Deepest technical moat; separate mountain (accuracy/safety/latency)
- [ ] **Wearable / recovery fusion**: HRV / sleep / readiness from Apple Watch / Whoop / Oura feeding the recovery model (moat #4)
- [ ] **Open / self-hostable**: homelab-native extensibility (MCP-style), self-host tier → community moat (only if personal → product)

### Cross-cutting (ongoing)
- [ ] Tests (pytest backend, Vitest/RN Testing Library frontend)
- [ ] Security (auth on every route, input validation, secrets in `.env`)
- [ ] Observability (structured logs, AI request tracing)
- [ ] Docs (README, ARCHITECTURE, HOWTO — your usual set)

---

## Open questions
1. **App name** — keep `gym-app` or brand it?
2. **Who uses it** — just you, or a few accounts (changes auth scope)?
3. **Getting it on your phone** — Expo Go for dev, then EAS dev build / sideload, or eventual app-store push?
4. **Default local model** — which Ollama model for parsing/coaching (e.g. `llama3.1`, `qwen2.5`)? Which on-device model/runtime for capable phones?
5. **First milestone to build** — recommend Phase 0 + Phase 1 (a working tracker you can use), then layer AI.
