# gym-app API

FastAPI backend for **gym-app**, an AI-assisted gym tracker. This phase (Phase 0
+ 1) covers the foundation and core tracking: multi-user auth, exercise catalog
(seeded from [free-exercise-db]), routines, workouts/sets logging, body metrics,
per-user settings, and basic stats. **No AI features yet** — the data model
keeps room for them (`settings.ai_provider`, `ai_model`, `feature_flags`).

[free-exercise-db]: https://github.com/yuhonas/free-exercise-db

## Stack

FastAPI · SQLAlchemy 2.x (typed declarative) · Pydantic v2 · SQLite · JWT
(PyJWT) · passlib[bcrypt] · Uvicorn.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `GYM_DATA_DIR` | `./data` | SQLite DB lives at `${GYM_DATA_DIR}/gym.db` |
| `GYM_JWT_SECRET` | dev string | **Set a strong value in prod** — a warning is logged if left default |
| `GYM_JWT_EXPIRE_HOURS` | `720` | Token lifetime |
| `GYM_CORS_ORIGINS` | `*` | Comma-separated allowlist, or `*` |
| `GYM_SEED_ON_START` | `true` | Fetch + import the exercise catalog on first boot (table empty) |

## Run locally

```sh
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000
# OpenAPI docs at /docs
```

Seed the exercise catalog manually (idempotent — skips if already present):

```sh
python -m app.seed.exercises
```

## Run with Docker

```sh
docker build -t gym-api .
docker run --rm -p 8000:8000 -v gym_data:/data -e GYM_JWT_SECRET=change-me gym-api
```

The image sets `GYM_DATA_DIR=/data`; mount a volume there to persist the DB.

## Tests

```sh
# In a venv:
pytest -q

# Or inside the image (no network; seeding disabled):
docker build -t gym-api-test .
docker run --rm -e GYM_SEED_ON_START=false gym-api-test pytest -q
```

Tests use a temp-file SQLite DB, disable network seeding, and insert a couple of
exercises directly.

## API

All routes are under `/api`. Auth is `Authorization: Bearer <jwt>` for everything
except `GET /api/health`, `POST /api/auth/register`, and `POST /api/auth/login`.
See `/docs` for the full interactive contract. Highlights:

- `auth`: `register`, `login`, `me`
- `exercises`: search/filter (`q`, `muscle`, `equipment`, `category`), custom CRUD
- `routines`: CRUD with embedded exercises
- `workouts`: `start` (optionally from a routine), add exercises, log/patch/delete
  sets, `finish`, paginated history
- `metrics`, `settings`, `stats/summary`

## Notes / TODO

- **Migrations**: tables are created with `Base.metadata.create_all` at startup.
  There is **no Alembic** yet — schema changes currently require recreating the
  DB. `# TODO: migrations` (add Alembic before the schema stabilizes).
- AI provider layer is intentionally out of scope for this phase.
