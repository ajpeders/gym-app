# Repository Guide

## Boundaries

- This is two independent projects with no root task runner: `api/` is Python 3.13/FastAPI; `frontend/` is Expo SDK 54/React Native/TypeScript. Run commands from the relevant directory.
- Use the settled domain names: a `Split` is a weekly plan, a `Workout` is a plan-day template, and a `Session` is a logged bout. Scheduling (`weekdays`, where 0=Sun, plus `floating`) belongs to `Workout`.
- Backend entrypoint is `api/app/main.py`; every REST router is mounted under `/api`, then the companion coach is mounted at `/api/companion`.
- Frontend routes live in `frontend/src/app`; API calls and manually mirrored contract types live in `frontend/src/api/client.ts` and `frontend/src/api/types.ts`. Keep those types/calls aligned with backend schemas and routes when changing the API.

## Verification

- API setup: `uv venv .venv && uv pip install -r requirements.txt`. Plain `pip` may fail building `pydantic-core` without a toolchain.
- API focused test: `.venv/bin/python -m pytest tests/test_sessions.py -q` (replace the file or append `::test_name`). Full check: `python3 -m compileall -q app && .venv/bin/python -m pytest -q`.
- Frontend install: `npm ci`. Typecheck: `npm run typecheck`; run `npm run export:web` when changing web/build behavior.
- Frontend unit tests (Vitest, pure `src/lib` logic — the offline queue is the one place a bug silently loses training): `npm test`, or focused: `npm test -- src/lib/offline.test.ts`. Screens and components are covered by the Playwright e2e suite in `frontend/e2e/` (`npm run e2e` builds the web bundle and runs it against a real API), not by unit tests.
- `npm run lint` (`expo lint`) has no ESLint config in the repo — eslint is not a declared dependency and no config file exists — so lint is not run in CI.
- CI is `.forgejo/workflows/ci.yml`, not GitHub Actions configuration. Three jobs: `api` (compile + pytest), `web` (npm ci, `tsc --noEmit`, `npm test`, advisory `expo-doctor`, `prebuild:check`), and `e2e` (real web build + Playwright against a real API/SQLite).

## Backend Traps

- Settings and the SQLAlchemy engine are created at import time, and `get_settings()` is cached. Tests must set `GYM_DATA_DIR`, `GYM_SEED_ON_START=false`, and related environment variables before importing `app`; `tests/conftest.py` already does this and uses an isolated SQLite file without network seeding.
- There is no Alembic. `create_all()` handles new tables only; for a new column, update `models.py` and add its `(table, column, SQL type)` tuple to `_ADDED_COLUMNS` in `api/app/db.py`.
- Preserve owner-scoped queries on authenticated resources. Missing and foreign-owned records intentionally both return 404.
- `companion` is pinned from Forgejo in `api/requirements.txt`. CI rewrites that public HTTPS URL to the runner's internal Forgejo address; do not replace it with a PyPI dependency.

## Frontend And Deploy Traps

- Use the SDK 54 versioned Expo docs (`https://docs.expo.dev/versions/v54.0.0/`), matching `package.json` and the lockfile. React Compiler is enabled in `app.json`.
- `EXPO_PUBLIC_API_URL` must be a bare origin such as `http://localhost:8000`; `client.ts` appends `/api`. The static web build bakes this value in at image build time.
- Only set logging is offline-first. `frontend/src/lib/offline.ts` persists queued sets before network writes; starting/finishing sessions and other mutations still require the API.
- Production publishes no API host port. Traefik sends `/api` to `gym-api` at higher priority and `/` to the static `gym-web`; both are behind `local-only@file`.
