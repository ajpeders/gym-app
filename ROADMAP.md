# gym-app — Roadmap

## Agent-sized TODO queue — 2026-09-18

These cards break selected existing priorities and observed gaps into small tasks.
They are the execution queue; the broader roadmap below remains product context.
Pick one card per change. Paths and commands are relative to this project root;
`(new)` marks a file to create. Read applicable `AGENTS.md` first. Check whether the
work has already landed before editing. If so, cite the implementation and checks
instead of rebuilding it. Install dependencies using this project's documented setup.

`ready` means no product decision is needed, not that every tool is installed.
Honor explicit dependencies and blocked/parked labels. Do not expand a card into an
architecture rewrite. If a contract or prerequisite is missing, record the blocker.
Mark a card complete only with its acceptance evidence; report changed files, checks
run, and remaining limitations. These TODOs do not authorize deployment, publishing,
live messages, or changes to production data.

- [x] **GYM-01 — Correct agent verification guidance for existing frontend tests** (ready)
  - **Why:** Root AGENTS.md says there is no frontend test suite, but package.json now contains Vitest and Playwright scripts.
  - **Start here:** AGENTS.md, frontend/package.json, frontend/vitest.config.ts, frontend/src/lib/offline.test.ts, .forgejo/workflows/ci.yml.
  - **Do:** Replace the stale no-tests statement with accurate focused unit-test, typecheck, and optional browser-check commands. Inspect workflow coverage and distinguish available scripts from checks actually run by CI. Keep backend setup and naming guidance.
  - **Done when:** All documented npm scripts exist. Verify a focused offline unit test from frontend with npm test -- src/lib/offline.test.ts and record any environment limitation. Do not imply browser tests run in CI unless configured.

- [x] **GYM-02 — Reconcile the workout-import remaining-work checklist** (ready)
  - **Why:** ROADMAP still calls CSV and retry-safe imports pending, while tests/test_csv_import.py, tests/test_idempotency.py and frontend/src/lib/import-key.test.ts now exist.
  - **Start here:** ROADMAP.md, api/tests/test_csv_import.py, api/tests/test_idempotency.py, frontend/src/lib/import-key.test.ts, frontend/src/app/workout-import.tsx.
  - **Do:** Trace each claimed capability from the UI through the API; tests alone are not proof of UI availability. Split CSV, JSON, Hevy/Strong, and retry handling into separate statuses. Cite existing implementation/tests for completed pieces and preserve genuine gaps.
  - **Done when:** Each status has code evidence; partial support lists its exact boundary. No new importer or data migration is built in this documentation task.

- [x] **GYM-03 — Stricter email validation on `/auth/register`** (ready)
  - **Why:** `api/app/schemas.py:53` documents a deliberate choice to accept `email: str = Field(min_length=1)` instead of `EmailStr`. POST `/auth/register` returns 201 for `"not-an-email"` (confirmed in live test against https://gym.thelunadog.com). Behaviour was deliberate once, but a string `min_length=1` also lets `"a"` through and will never diagnose a typo at signup — by far the cheapest user-support ticket this app can produce.
  - **Start here:** api/app/schemas.py (the RegisterIn / OAuthIn shapes), api/app/routes/auth.py (`/register`, `/login`, `/oauth/.../start` handlers), api/tests/test_auth.py.
  - **Do:** Decide product-side whether to switch to `pydantic.EmailStr` globally (forces RFC 5321-ish shape; OAuth providers still pass their own validator so no regression there) or only at `/auth/register` (keep OAuth inputs loose). Add the chosen validator to `RegisterIn`; keep the existing tests green. Cover the new behaviour with focused tests: accepts a normal address, rejects `not-an-email` and `a@b` at 422 with a useful message, accepts an OAuth-supplied address unchanged.
  - **Done when:** A bad shape returns 422 with a validation error mentioning the field. OAuth providers still register successfully (the provider already validated). No regression on existing auth tests. This is a tightening only — do not change password rules here.

- [ ] **GYM-04 — Make offline/syncing state visible to users** (ready)
  - **Why:** `lib/offline.ts` persists queued writes silently; users have no way to tell a set is queued, is flushing, or just landed. Logs are reliable on paper but invisible in practice — a user who drops signal mid-session may stop trusting the counts.
  - **Start here:** frontend/src/lib/offline.ts (queue, IDMAP, plans cache), frontend/src/api/client.ts (queue-drain triggers), frontend/src/app/(tabs)/_layout.tsx (where to show a global banner), frontend/src/app/session/active/[id].tsx (where it matters most — a set just queued).
  - **Do:** Surface (a) "Offline — N writes queued, will sync when back online" in the tab bar or app header when the queue is non-empty, (b) per-set "Queued" / "Synced" badge on the active-session set card so the doubt goes away mid-workout, (c) "Syncing…" on app foreground or reconnect so the work isn't invisible. Reuse `useNetInfo` if already wired; do NOT add push notifications. Do NOT surface retry errors in red — write failures recover, a panic badge would teach the user to ignore it.
  - **Done when:** A set logged with no connection shows a "queued" indicator on the card; on reconnect the indicator flips to "synced" and the banner clears. Empty queue = no banner. Tests in `offline.test.ts` cover the indicator derivation pure function.

- [ ] **GYM-05 — Define the jargon: rolling, split, catch-up, makeup day, RPE** (ready)
  - **Why:** Home/Splits/History use "rolling", "catch up", "makeup day", "RPE" without inline definitions. A first-time lifter hits these on day one. Code-level help exists in some screens (e.g. the Spotter skill file) but isn't surfaced on the screens that use the words.
  - **Start here:** frontend/src/app/(tabs)/index.tsx (Home), frontend/src/app/(tabs)/workouts.tsx (Splits), frontend/src/app/(tabs)/history.tsx, frontend/src/app/(tabs)/more.tsx, frontend/src/components/coach/CoachCheckin.tsx, frontend/src/components/ui/Logo.tsx (for an icon-able tooltip pattern already in use).
  - **Do:** Add a one-line plain-English line under each first-use term — short, not a tutorial. Examples: "Rolling split — schedule frees up if you miss a day", "RPE — Rate of Perceived Exertion, 1 (easy) to 10 (max)", "Catch up — log a session for a day you missed". Prefer inline muted text over info-icon tooltips; touch screens probe less than they read. Keep cards terse. Do NOT add a long glossary screen — a user who needs one isn't the one with a glossary screen.
  - **Done when:** Every user-facing string in the terms list above has an inline definition on its first appearance in the app. No new component added unless the inline pattern doesn't fit; reuse the existing muted `Text` variant.

- [ ] **GYM-06 — Bring logging into Home for new users** (ready)
  - **Why:** The actual logging loop is two taps deep (Home → "Empty session" → add-exercise). Home already shows three actions including "Log by text" — that's surface area, but a first-time user lands on Home without a plan and is silently funnelled toward "Import your first split" before they ever log a set. Discoverability problem, not a feature problem.
  - **Start here:** frontend/src/app/(tabs)/index.tsx, frontend/src/app/more.tsx, frontend/src/app/session/add-exercise.tsx, frontend/src/app/log-chat.tsx.
  - **Do:** Make the "Empty session" and "Log by text" actions visibly primary on Home for a brand-new account (`onboarded === false` OR `splits.length === 0`). Keep the existing card structure; the fix is prominence, not a new card. Verify the action reaches the same screens it reaches today — this is a layout/props change, not a flow rewrite.
  - **Done when:** A new account (zero splits) lands on Home and the first thing visible is one of the two logging actions at visual primary tier. Existing accounts are unchanged. Typecheck + a Playwright e2e covers the new-account path.

## Process notes

- **2026-09-19 — subagent dispatcher dies on this checkout.** Two consecutive parallel dispatches of card work (GYM-03+04+06 and the serial re-dispatch of GYM-03) all reported "Delegation owner exited before recording a terminal result" within ~3 minutes of spawn, with no files changed on disk. Root cause surfaced during the manual GYM-03 pass: `/home/alex/hermes-workspace/projects/gym-app` is owned by uid 1005; this session runs as uid 1002; the FUSE mount serving that tree denies `readlink` across uids (`/home/alex/hermes-workspace/projects/gym-app/api/.venv/bin/python` → `failed to canonicalize path ... Operation not permitted`, and the same for `frontend/node_modules/.bin/*`). Subagent tooling path-canonicalizes its workdir on entry, so dispatch dies before any tool call. Workaround used for GYM-03: run the work in the parent session, build the venv at `/tmp/gym-venv` (`VIRTUAL_ENV=/tmp/gym-venv/.venv uv pip install -r api/requirements.txt`, then `/tmp/gym-venv/.venv/bin/python -m pytest`), and invoke frontend binaries directly (`node node_modules/vitest/vitest.mjs`, `node node_modules/typescript/bin/tsc`). Real fix is a perms/uid fix on the homelab user running this checkout — that belongs in the homelab repo, not here. Card status: **GYM-03 done manually** (commit `f2aad77`); GYM-04 / GYM-05 / GYM-06 still unimplemented.

> AI-assisted gym tracker. Log workouts, track progress, and get coaching from
> a local (Ollama) or frontier (Claude) model. Native-first (Expo / React
> Native) with a web build from the same codebase.

Status: **Phases 0–4 shipped; UX pass done; launch-ready bar the EAS build; one open item (usable by others)** · Last updated: 2026-09-19

## Pointed backlog (agent dispatch)

Story points (1/2/3/5/8): 1–2 = mechanical, safe unattended; 3 = needs
codebase context; 5–8 = design judgment. [human-assisted] = needs credentials
or decisions only the user can supply. This is the open-work index; each item's
full context lives in the sections below.

| Pts | Item |
|-----|------|
| 1 | [human-assisted] EAS login/init + preview APK build (credentials only — see "Finishing the launch") |
| 1 | [human-assisted] Create Google/GitHub OAuth client, set `GYM_*_CLIENT_ID` (buttons appear automatically) |
| 2 | Universalize for outside users (see "Make this usable by others" — homelab hosts/LAN IPs in `.env.example`, compose, `eas.json`; `companion` installs from private Forgejo) |
| 5 | Catch RN coach-chat client up to companion v0.6 (token/thinking streaming, trust-this-session, provider picker — docuAI's web ChatPanel is the behavioral spec) |

## Finishing the launch — the two steps only you can take

Everything else is done and verified. These need credentials this project
doesn't have:

1. **Ship a build.** `cd frontend && npx eas-cli login && npx eas-cli init`
   (interactive; `init` writes `extra.eas.projectId`), then
   `npx eas-cli build --profile preview --platform android` for an installable
   APK. Config is checked in and CI already runs `expo-doctor` and
   `expo prebuild`, which is what an EAS build does first — so this should be
   the boring part.
2. *(Optional)* **Social sign-in.** Create a Google or GitHub OAuth client and
   set `GYM_GOOGLE_CLIENT_ID` / `GYM_GOOGLE_CLIENT_SECRET` (or the GitHub pair).
   The buttons appear on their own once the server advertises a provider —
   HOWTO has the redirect URI.

One piece of engineering remains, and it isn't needed for v1: making the repo
runnable by outsiders (last section — `.env.example`, `docker-compose.yml` and
`frontend/eas.json` still default to homelab hosts and LAN IPs, and
`companion` installs from the private Forgejo). Every other checkbox is ticked
or partial. Three
things were decided against rather than deferred — on-device AI, Apple Health
and camera form-check — and are recorded under "Not open work" with the
reasoning. An unchecked box in this document always means work that's actually
outstanding.

## Launch scope (what "done" means for v1)

Everything below this section is either shipped or deliberately after launch.
Written down because a roadmap with open boxes reads as unfinished jobs, and
most of what's left is not: it needs hardware, an Apple developer account, or a
bet this project hasn't decided to fund.

**In scope, and done.** Logging (plan, session, sets, rest, swaps, supersets,
timed and bodyweight movements), splits in both weekday and rotation form,
catch-up, a library of well-known programs, import from pasted text *and* from
Hevy/Strong CSV, the exercise catalog with custom exercises and photos, history,
insights (per-muscle volume against the usual landmarks, balance ratios,
strength trends, weekly tonnage, recovery, milestones), next-session targets,
gym-floor calculators, nutrition with a common-foods shelf, athlete profile, the
tool-calling Spotter with bring-your-own model plus generated programs and
exercise Q&A, accounts with onboarding, data export and delete, an operator view
(accounts, crash reports, AI health, catalog state), and offline-first logging
including *starting* a workout with no signal.

Also: local notifications for rest and training days, voice logging where the
platform can hear, hands-free logging via a deep link (so a Siri Shortcut
works today), social sign-in built and waiting only on OAuth credentials, a
daily readiness check-in in the shape a wearable would fill, and one-command
self-hosting verified by running it on a machine with no homelab.

Tested by 454 API tests, 61 frontend unit tests, and 71 end-to-end journeys
through the real stack — all three in CI.

**In scope, needs a human.** The EAS build. Everything that can be checked
without an Expo account has been: `expo-doctor` passes 18/18 and `expo prebuild`
generates both native projects, which is the first step an EAS build takes — and
both now run in CI. What's left is `eas login` and `eas init` (interactive; the
latter writes `extra.eas.projectId`) and a build on Expo's infrastructure. Also
optional: OAuth client ids, if you want the social sign-in buttons to appear.

**Nothing below is outstanding engineering.** Everything has shipped, shipped in
the half that doesn't need hardware, or been closed by decision — each marked
with what exists and what any remaining step actually is. Three features were
cut outright (on-device AI, Apple Health, camera form-check); they're recorded
under "Not open work" with the reasoning rather than sitting in the list
pretending to be a backlog.

Two items were **closed by decision rather than by code**, which is worth
distinguishing from "not done": in-set AI prompts contradict the Spotter's
constraint against volunteering advice, and multi-user profiles were superseded
by real accounts.

**Known limits, accepted for v1.** No conflict resolution if the same session is
edited on two devices at once (last write wins). 338 of 828 catalog rows have no
image. A retry of a *failed* import is safe (`Idempotency-Key`), but re-importing
a plan you already have still needs you to pick "Update" — otherwise it lands as
a second split rather than reconciling automatically. Adding a
*new* exercise offline queues but shows nothing until it syncs. RPE-based
calibration waits for real RPE data rather than shipping a model of nobody.

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
- **Lavish local compute (Tier 1).** Zero marginal AI cost (homelab Ollama)
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

Tier-3 bets (roadmap'd, not now): wearable/recovery fusion, open/self-hostable
homelab-native ecosystem. *Camera form-check was on this list and was dropped
2026-08-16 — see "Not open work".*

Not moats — don't over-invest: the public exercise DB, the tracker UI, generic AI chat,
one-shot generated programs.

## Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| App (mobile + web) | **Expo (Expo Router) + React Native + TypeScript** | `react-native-web` for the web build; one codebase → iOS/Android/web |
| Styling | **NativeWind** (Tailwind for RN) | keeps the Tailwind muscle memory from your other apps |
| Backend | **Python FastAPI** + SQLAlchemy (~~Alembic~~ → hand-rolled additive migrations) | matches docuAI/discordbot AI-app pattern; Alembic deferred — `db.py` ALTERs new columns in idempotently |
| DB | **SQLite** to start → Postgres if needed | lives in `state/gym-app/`, covered by homelab backup |
| AI | **Provider abstraction**: Ollama (default) ⇄ Claude ⇄ ChatGPT, per user | Ollama at `192.168.0.40:11434` / `.47`; Claude via API key; on-device AI was cut (see "Not open work") |
| Exercise data | **free-exercise-db** (~870 exercises + images, public domain) | seeded into our DB at first boot |
| Auth | Bearer/JWT token, real accounts with onboarding (optional Google/GitHub sign-in) | defence-in-depth behind Traefik `local-only@file` |
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
- [~] **Import anything** (moat #3): notes-app text → routines ✅, structured CSV/JSON plans ✅ (no AI needed; `POST /api/splits/import` applies the reviewed plan in one idempotent transaction), **Hevy/Strong CSV ✅ (2026-08-16)** — `POST /api/sessions/import-csv` sniffs the format from the header row and normalises both, no model involved because a CSV is structured data; sessions keep the dates they happened on, warmups stay warmups, and unmatched movements are reported. `GET /api/sessions/export.csv` writes a file the importer can read back. **next: whiteboard photo (vision), PDF coach program**
- [x] Units (kg/lb), basic settings screen
- [x] **Bottom nav tabs restored** — Home / Workouts / Routines / Coach / Settings (Exercises reachable as a route, hidden from the bar)

### Phase 2 — Live workout mode ✅ (mostly)
- [x] Start session (blank or from routine); active-session screen *(`workout/active/[id]`)*
- [x] **Quick-action set buttons** (auto-fill from last session) — toggleable via `feature_flags.quick_buttons`
- [x] Rest timer + supersets — the live rest timer shipped earlier (tap to start,
      counts up, saved with the next set). **Supersets shipped 2026-08-16**:
      `superset_group` on the plan exercise and snapshotted onto the session,
      because A1/A2 changes what the session *is* — you take one rest for the
      pair, not one each. Modelled as a short label rather than a groups table:
      one nullable column, survives reordering, and "no group" stays the
      default that costs nothing. The label is never typed — the editor asks
      "superset with the next exercise?" and the runs are relabelled A, B, C
      from adjacency (`lib/supersets.ts`, unit-tested), so a group whose
      members aren't next to each other, or a group of one, can't exist. The
      session card shows the letter beside the movement.

- [x] Inline progress (this session vs last); session summary on finish
- [~] **Contextual AI prompts during the set** — **dropped as specified, 2026-08-16.** The flag
      (`feature_flags.in_set_prompts`) stays, but a model volunteering cues between sets is
      the exact behaviour Alex ruled out when the Spotter was constrained to tools and
      readback ("I want the chat to not recommend or do anything… so a shitty llm won't
      nudge in a terrible direction"). Building it would contradict a decision already made
      deliberately. What replaced it is *asked-for* and grounded: the progression nudge and
      next-session targets are arithmetic (`app/overload.py`), and the exercise Q&A answers
      a question you chose to ask, from that movement's own catalog entry. If this ever
      returns it should be pull, not push.

### Phase 3 — AI provider layer + natural-language logging (largely done)
- [x] Provider abstraction: Ollama ⇄ Claude ⇄ ChatGPT/OpenAI; pick provider/model in settings *(BYO per-user, no silent default; `/ai/providers`,`/models`,`/test`). OpenAI shipped 2026-08-16 via the existing companion OpenAI-compatible provider, with per-user write-only API keys and `gpt-5.6` as the default API model.*
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
- [~] **Voice companion** (moat #5) — **speaking instead of typing shipped
      2026-08-16** on every platform that can hear: the mic button on the
      log-by-text screen runs the platform's own recogniser (Web Speech on
      Chrome/Edge/Safari and Android Chrome) and feeds the transcript straight
      into the existing parser, so "bench three by eight at sixty" logs three
      sets. Nothing is recorded by us. Where the platform has no recogniser —
      Firefox, Expo Go — the button is absent rather than present and dead.
      **Still open:** a *spoken* pre-session check-in that talks back, and
      on-device recognition in a native build; both need a real build and, for
      the reply half, a decision about a model talking unprompted (see the
      dropped in-set prompts).

- [~] **Siri / App Intents (iOS)** (moat #5) — **hands-free logging works now,
      via Shortcuts rather than a native intent** *(2026-08-16)*: the app answers
      `gymapp://log-chat?text=…` and parses the phrase on arrival, so a
      three-action Shortcut (Dictate → URL → Open) gives "Hey Siri, log a set"
      without a native build. Recipe in HOWTO. The same link works from a
      home-screen shortcut, an NFC tag, or Tasker on Android.
      **Still open:** a real App Intent, which would let Siri answer *without*
      opening the app — that needs a native module and an Apple developer
      account, neither of which exists here yet.

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
      unmatched, so the shared catalog is never altered. Status per capability:
  - [x] **Pasted-text import** (notes/plain text, plan or routine) — `frontend/src/app/workout-import.tsx` (parse → per-day/per-exercise review → `api.importSplit`), served by `api/app/routes/splits.py:191-206` (`POST /api/splits/import`, one transaction, creates user-owned custom exercises for unmatched names). AI parse path: `api.parseWorkoutStream` (`frontend/src/app/workout-import.tsx:213`).
  - [x] **CSV import (structured plan read without AI)** — `parseStructuredPlan` short-circuits the model for CSV/JSON pastes and matches names via `api.matchExercises` (`frontend/src/app/workout-import.tsx:161-199`, `frontend/src/api/client.ts`, served by `api/app/routes/exercises.py:92` `POST /api/exercises/match`). Review screen labels the source `CSV — no AI involved` (`frontend/src/app/workout-import.tsx:547-549`).
  - [x] **JSON import (app's own export shape, incl. workout export)** — same structured path; `plan.source === 'json'` (`frontend/src/app/workout-import.tsx:167`). Round-trips with `lib/export.ts` text/JSON export.
  - [x] **Hevy/Strong CSV history import** — UI: `frontend/src/components/HistoryCsvImport.tsx` ("Coming from Hevy or Strong?" on History) → `api.importCsv` (`frontend/src/api/client.ts:866-870`) → `POST /api/sessions/import-csv` (`api/app/routes/sessions.py:274-333`), format sniffed from the header row in `api/app/csv_io.py`. Sessions keep their real dates, warmups stay warmups, unmatched movements are reported (not dropped). Tested: `api/tests/test_csv_import.py` (sniffing, normalisation, warmup preservation, ordering, unmatched reporting, and export→re-import round-trip). Export side: `GET /api/sessions/export.csv` (`api/app/routes/sessions.py:336-379`).
  - [x] **Retry-safe import (idempotency)** — the split import is one transaction and carries an `Idempotency-Key` derived from the parse nonce + reviewed payload (`frontend/src/lib/import-key.ts`, used at `frontend/src/app/workout-import.tsx:356-358`); the server replays the first answer instead of re-running (`api/app/routes/splits.py:191-206` via `replay_or_run`). Unit-tested in `frontend/src/lib/import-key.test.ts`; replay behaviour for the queued-write surface pinned by `api/tests/test_idempotency.py`.
  - [~] **Re-running an import reconciles (still open)** — retry after a *failed/timed-out* save is safe, but deliberately re-importing the same plan does not reconcile by itself: with no plan selected the UI warns "Re-importing a plan you already have will leave you with two of it" (`frontend/src/app/workout-import.tsx:604-606`). Choosing an existing plan updates by day name instead — matching days updated in place, new ones added, absent ones removed (`replace_split_id`, `frontend/src/app/workout-import.tsx:588-607`). That is a user choice, not automatic reconciliation.
  - [ ] **Whiteboard photo (vision) and PDF coach program** — not built; no route, no UI (`Import anything` next-step in Phase 1).
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
- [x] **UI/UX pass** *(2026-09-10)* — the 31-page walkthrough of 2026-09-07
      (`docs/ux-review-2026-09-07.md`, with Alex's verdict on every item) was
      built in eight themes, one commit each: the six bugs it found; a front
      door, a real header block, one name per screen, back arrows on web and
      a More tab; the logging loop (thumb-sized inputs, one primary button, a
      rules parser so voice and text logging need no AI, a finish summary);
      AI setup on the Spotter screen and AI surfaces hidden without a
      provider; one rule for a session and one source for weight; eight
      screens decluttered; forgot-password, delete account, log-out confirm;
      catalog instructions and muscle names made readable. Remaining polish
      is post-launch product work, not review debt.
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
  - [~] **EAS build + distribution** — *config landed 2026-08-13; verified as far
        as an account allows 2026-08-16.* `eas.json` with development / preview /
        production profiles, `com.forgo.gymapp` on both platforms, and
        `EXPO_PUBLIC_API_URL` pinned per profile (a device build can't reach
        `localhost:8000`; the value is baked in at build time).
        **What's now proven without an Expo account:** `expo-doctor` passes all
        18 checks (it caught an out-of-date `expo` patch, and repairing that
        exposed `babel-preset-expo` no longer hoisting — the web bundle broke
        and is fixed), and `expo prebuild` generates both native projects
        cleanly. That's the first thing an EAS build does, so a config that
        would fail there fails here first. Both run in CI now
        (`npm run prebuild:check`, which restores the files prebuild rewrites).
        **Still needs a human:** `eas login` and `eas init` are interactive, and
        `eas init` is what writes `extra.eas.projectId`. No build has been run
        on EAS itself, and it can't be from a terminal without the account.

### Phase 4 — AI insights & coaching (started)
- [~] **Progress analysis**: `/stats/summary` ships streak, weekly volume, and recent PRs (+ a `progress` screen); **plateaus, per-muscle volume, frequency still to do**
- [x] **Muscle coverage & volume analysis** *(2026-08-16)* — `GET /api/stats/muscles?weeks=N` and the Insights screen (History → Insights). Hard sets per muscle over a 1/4/12-week window, primary full credit and secondary half, warmups and drops excluded; every landmark muscle is returned including the untrained ones, because a muscle missing from the list is the one that goes unnoticed. Status against MEV/MAV/MRV reads under / productive / over, plus push:pull and quad:ham ratios (a side with no volume reports "nothing to compare", never infinity). The maths is pure and tested (`app/analysis.py`, `tests/test_analysis.py`); **AI interpretation on top is still open** and deliberately so — the numbers must be counted, not generated.
- [~] **Advanced metrics** — **e1RM trends and tonnage shipped 2026-08-16** (`GET /api/stats/exercises/{id}/trend`: Epley per session day from the top set, direction up/down/flat with a 2% threshold so noise isn't read as progress, total tonnage). Double progression already drives the nudge and the next-session targets. **Still open:** rep-PRs, RIR/RPE autoregulation, periodization/deload tracking
- [~] Charts/dashboard — weekly tonnage bars and per-muscle volume bars on the Insights screen (plain Views; a charting library is a lot of bundle for eight bars). **Est-1RM and body-metric charts still to draw** — the trend data is already served, and the weight series now exists: weigh-ins are loggable and backdatable (`components/WeighIns.tsx`, Progress screen).
- [~] **Workout generation** from goals + equipment *(2026-08-16)* — `POST /api/ai/generate-program` writes a program from goal, days per week and equipment, grounded in the athlete profile and told to adapt a standard split rather than invent one. It returns the *same shape* as a pasted import and runs through the same `_build_workout_result`, so the exercises are matched against the catalog, ranges normalised and timed movements repaired — a generated program that names a lift the catalog lacks is visibly unmatched rather than silently wrong. Nothing is saved: it lands in the importer's review screen, which already handles unmatched exercises. **Not reachable from the app** — *shelved 2026-08-18, Alex's call: not ready to let AI write a program.* Import → "Don't have one?" now routes to the presets shelf instead. The endpoint, prompts, service and tests all stay green, so turning it back on is a UI change. **Recent fatigue is not an input yet** — that needs the recovery model below.
- [~] **AI-generated routines** *(2026-08-16; UI shelved 2026-08-18 — see Workout generation above)*: a full multi-day program from goals + experience + equipment + weekly schedule (and athlete memory once present) → saved as normal editable routines. The inverse of Import (bring a plan *in* ↔ generate one *out*); reuses the same routine/exercise-catalog-matching pipeline so generated exercises resolve to the real catalog. Keep it **editable + regenerable, not one-shot** — one-shot programs aren't a moat (line "Not moats"); the defensibility comes from regenerating against *your* logged history, calibration, and recovery signal
- [x] **Progressive-overload suggestions for the next session** *(2026-08-16)* — `GET /api/workouts/{id}/suggestions` and the "Next time" card on Insights. Same rule as the progression badge (`app/overload.py` beside `app/progression.py`), so the two can never disagree: clear the top of the rep range on every working set and the weight goes up, by an increment that matches the equipment — 2.5kg barbell, 4kg dumbbell pair, 5kg machine stack, because advice you can't follow is worse than none. Bodyweight adds a rep, timed holds add five seconds, and the baseline is the heaviest working set rather than the last one. Deterministic throughout: a suggested weight is training data, and an invented one is worse than nothing.
- [x] **Form / exercise Q&A** *(2026-08-16)* — `POST /api/ai/exercise-qa` and an "Ask about this movement" box on the exercise screen. The retrieval turns out to be a primary-key lookup: there is exactly one relevant document, the exercise you're looking at, so no vector store is involved. The model gets that entry and is told to answer *from* it and to say when it doesn't cover the question — the difference between grounded and confident. Two or three sentences, because you're between sets; pain is met with "stop and ask someone qualified", never a diagnosis; a listed injury gets a substitution rather than a workaround. An entry with no instructions (338 of 828 rows) is answered but flagged as ungrounded, because that answer is worth less trust.
- [x] **Athlete memory** (Tier-1 moat): `athlete_profile` model + `/ai/check-in` (NL → profile) + `/profile` CRUD; injected into every coach/parse prompt via `profile_summary`. *(Calibration/recovery signals below still to layer on.)*
- [~] **Personal calibration flywheel** (moat #4) — **the deterministic half shipped
      2026-08-16**: next-session targets come from your own last session and the plan's own
      rule, with equipment-shaped increments (`app/overload.py`), and per-exercise e1RM
      trends track whether it's working (`/stats/exercises/{id}/trend`). **Still open:** the
      *adaptive* half — RPE-to-weight calibration that learns each lifter's own scale. That
      needs months of a real person's RPE data to be anything but invented, so it waits for
      the data rather than shipping a model of nobody.
- [~] **Recovery from usage** (moat #4) — **v0 shipped 2026-08-16**: per-muscle last-trained and weekly volume are read off the log and turned into recovering / ready / overreached / neglected, least recovered first, on the Insights screen. Coarse on purpose — "legs were yesterday", not a recovery score pretending to be measured — and volume beats the clock, because three days off doesn't undo a week at 40 sets. "Neglected" rather than "fresh" for a muscle untouched for a week, since *fresh* invites another rest day. **Still open:** using this to gate volume/intensity
- [~] **Lavish AI** (Tier-1 moat) — this is a posture rather than a feature, and the
      groundwork is in: BYO local provider means zero marginal cost, and nothing in the app
      rations AI calls. What's deliberately *not* built is anything that spends that budget
      without being asked — see the dropped in-set prompts above. Generosity here means
      "ask as much as you like", not "we'll talk at you because it's free".

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
- [x] Notifications (rest done, training reminders) *(2026-08-16)* — **local, not push**, which is the whole design: the phone already knows when the rest timer is up, and routing that through a server needs a push token, a service worker and something awake in the homelab to send it. One seam (`lib/notifications.ts`) over two backends — the browser Notification API on web (works today, including the installed PWA) and `expo-notifications` on device, required lazily so its absence in Expo Go degrades to silence rather than a crash. Rest alerts fire against the plan's own rest, which is now snapshotted onto the session like every other target; reminders schedule with the OS on device and with a timer on web, and the settings copy is honest that a web tab has to be open. Both toggles live on the account, so a second phone already knows. Scheduling maths is pure and unit-tested (a reminder set for 08:00 at 09:00 belongs to tomorrow, not to an hour ago).
- [x] Plate / warmup / 1RM calculators *(2026-08-16)* — `GET /api/tools/{plates,warmup,one-rep-max}` and a Calculators screen (History → Calculators). Plates are greedy heaviest-first, which is both optimal for real plate sets and the order you physically load them; a target the plates can't make reports the nearest one and how much you're short rather than failing. Warmups ramp from the empty bar on weights that are actually loadable, and stay short for a light working weight. The max estimate shares `analysis.e1rm`, so it can't drift from the strength trend. All pure and tested (`app/calculators.py`) — this is the maths you'd do standing at the bar, and it must not need a network.
- [x] Export/import: text + JSON export via the Share sheet (`lib/export.ts`), a full JSON account export, and **CSV import/export (2026-08-16)** that round-trips — an export you can't re-import is a screenshot with extra steps. A plan (CSV/JSON, incl. our own workout export) re-imports without a model. **Backup fold-in still to do**
- [x] Multi-user profiles — **superseded**: this was written when the app had one shared
      login. Real accounts shipped (register/login, per-owner scoping on every route,
      per-user AI config and athlete memory), and the operator view manages them. Two people
      sharing a phone log into their own accounts; there is nothing left for a "profile"
      concept to add.
- [~] **Social / OAuth login** — **built, needs credentials** *(2026-08-16)*.
      Google and GitHub work end to end: `/auth/providers` advertises whichever
      have a client id, the browser starts at `/auth/oauth/{provider}/start` so
      the client secret never reaches the app, the code is exchanged
      server-side, and only our own session token comes back to the app's deep
      link. An account is matched on a **verified** email — anything less would
      let a throwaway address claim someone's training — and one created this
      way gets a random password hash so nothing can log into it with a
      password. Redirects are allowlisted (an open redirect here hands out a
      session token) and the `state` is signed. Tested with the provider call
      stubbed, including the hostile cases.
      **Needs a human:** creating the OAuth clients. Recipe in HOWTO. Apple is
      deliberately refused until its JWKS validation is done properly.

### Tier-3 moat bets (future — bigger builds)

- [~] **Wearable / recovery fusion** — **the half that doesn't need hardware
      shipped 2026-08-16**: a daily check-in (`/api/readiness`) in exactly the
      fields a watch reports — sleep hours, resting HR, HRV — plus the two only
      the athlete can give (soreness, energy). Scored deterministically into
      good / fair / poor with a one-line reading, and *advisory*: the app does
      not get to tell someone they may not train. Saying nothing scores
      nothing, because an empty form is not a bad day. One check-in per day;
      partial answers are fine.
      Keeping the shape identical to a wearable's output is the whole point —
      **the integration itself was cut 2026-08-17** (see "Not open work") — the
      manual check-in is the feature, and a wearable would only be a nicer way
      to fill the same rows.

- [~] **Open / self-hostable** — **one-command self-hosting shipped 2026-08-16**:
      `docker-compose.selfhost.yml` runs the whole app with no homelab —
      published ports, a named volume, nothing external — and the API image now
      builds with plain `docker build`. The Dockerfile's BuildKit secret for a
      deploy key was vestigial (the `companion` dependency has been public and
      fetched over https since July) and was what stopped the image building on
      a host without buildx. Verified by running it: a fresh install seeded its
      own catalog from wger, registered an account and adopted a preset program
      with every lift matched.
      **Still open:** the community half — an extensibility surface (MCP-style)
      and a self-host *tier*, which the Moats section says only to fund if this
      goes from personal project to product.

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


## Not open work: features that were cut

An unchecked box in this roadmap means **outstanding engineering**. Nothing here
is that: each of these was decided against, with the reasoning kept so the
decision can be revisited on its merits rather than re-argued from scratch.

### Dropped

Recorded rather than deleted, so none of them comes back around as a fresh idea
in six months.

- **On-device AI — iPhone first** — *cut 2026-08-17.* The case for it was "AI
  works at the gym with no network", and it doesn't survive contact with the
  measurements: gemma can't tool-call at all and there's a real quality gap
  between qwen2.5:7b and qwen3:8b, so a 1–3B phone-class model would be worse
  at the two jobs this app actually gives a model — resolving exercises and
  calling tools. Shipping one deliberately would undo the work that stopped a
  weak model authoring bad training data. The cheaper answer to the same
  problem is a VPN back to the homelab, and logging already works fully
  offline; only the AI extras need reach. *(The provider seam stays BYO and
  runtime-selected, so nothing about the architecture depended on this.)*

- **Apple Health / Google Fit + Apple Watch** — *cut 2026-08-17.* Both things
  that motivated it are already covered another way: getting your data out is
  CSV export, and the recovery inputs a watch would supply have a manual
  check-in in exactly the same shape. Against that, £79/yr for the Apple
  Developer Program, a native module and a maintenance surface. Worth
  revisiting *only* if an Apple developer account is being paid for anyway,
  at which point it's a small marginal addition.

- **Camera form-check** (CV/pose) — *cut 2026-08-16, Alex's call: not a feature
  this product wants.* The reasoning that supports the decision, if it ever
  comes up: a form checker that is occasionally wrong is worse than none,
  because it gets trusted.

Bring one of these back by moving it into the phase lists with a checkbox —
that's the signal it's become real work again.

### Shelved

Built and tested, but not offered in the app.

- **AI writes your program** — *shelved 2026-08-18, Alex's call.* The generator
  works and stays under test; it just isn't something to hand a user yet. A
  generated split is a claim about how someone should train for the next few
  months, and the seven presets are plans that already work — so the importer's
  "Don't have one?" points there. `POST /api/ai/generate-program`,
  `service.generate_program`, both prompts and `api.generateProgram` are intact
  and unused; re-exposing it is a card on the import screen, nothing more.

## Open questions
1. **App name** — keep `gym-app` or brand it?

Answered (kept for the record):
- **Who uses it** — real accounts shipped, so anyone the server lets sign up.
- **Getting it on your phone** — EAS `preview` build → installable Android APK (see "Finishing the launch"); app stores not decided.
- **Default local model** — measured 2026-08-14: qwen2.5:7b and qwen3:8b both work, gemma can't tool-call at all. The in-app model check scores an installed model against what the app actually needs.
- **First milestone** — Phases 0–4 shipped.

## Make this usable by others (added 2026-08-27)

- [ ] Universalize the README / docs / code for outside users: document setup
  from scratch on generic infrastructure, replace homelab-specific assumptions
  (private hostnames, LAN addresses, personal paths and defaults) with
  env-driven configuration plus examples, and keep the public GitHub mirror
  directly runnable.
