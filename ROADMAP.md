# gym-app — Roadmap

> AI-assisted gym tracker. Log workouts, track progress, and get coaching from
> a local (Ollama) or frontier (Claude) model. Native-first (Expo / React
> Native) with a web build from the same codebase.

Status: **planning** · Last updated: 2026-06-26

---

## Vision

A personal strength-training tracker that feels great on the phone *during* a
workout (fast set logging, rest timers, quick-action buttons) and gets smarter
over time via a pluggable AI layer — natural-language logging, progress
analysis, workout generation, and a form/exercise Q&A coach. Everything runs in
the homelab; AI defaults to local Ollama and can flip to Claude per request.

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
- [ ] Units (kg/lb), basic settings screen

### Phase 2 — Live workout mode
- [ ] Start session (blank or from routine); active-session screen
- [ ] **Quick-action set buttons** (auto-fill from last session) — *toggleable*
- [ ] Rest timer (per-set) with local notifications; supersets
- [ ] Inline progress (this session vs last); session summary on finish
- [ ] **Contextual AI prompts during the set** (e.g. nudge, form cue) — *toggleable*

### Phase 3 — AI provider layer + natural-language logging
- [ ] Provider abstraction: Ollama default ⇄ Claude; pick provider/model in settings
- [ ] **On-device AI** (capable phones): run a small local model on the phone's hardware (Core ML / `llama.rn` / ExecuTorch) — private, offline; auto-detect support and offer as a provider
- [ ] **Natural-language logging**: "bench 3x8 @60kg, felt easy" → structured sets
- [ ] Voice input (speech-to-text) → NL logging
- [ ] Robustness: validation/repair of model output, fallbacks, cost/latency display

### Phase 4 — AI insights & coaching
- [ ] **Progress analysis**: trends, PRs, plateaus, volume per muscle, frequency
- [ ] Charts/dashboard (volume over time, est 1RM, body metrics)
- [ ] **Workout generation** from goals + equipment + recent fatigue
- [ ] Progressive-overload suggestions for the next session
- [ ] **Form / exercise Q&A** chat coach (RAG over exercise DB)

### Phase 5 — Polish & power features
- [ ] PRs, achievements, streaks
- [ ] Offline-first sync (native) with conflict resolution
- [ ] Push notifications (rest done, workout reminders) via ntfy/web-push
- [ ] Plate / warmup / 1RM calculators
- [ ] Export/import (CSV/JSON); fold into homelab backup
- [ ] Multi-user profiles (optional)
- [ ] Apple Health / Google Fit + Apple Watch (stretch)

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
