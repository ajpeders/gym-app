"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai import telemetry as ai_telemetry
from .config import get_settings
from .db import SessionLocal, init_db
from .image_overrides import use_image_overrides
from .routes import (
    admin,
    ai,
    auth,
    errors,
    exercise_media,
    exercises,
    health,
    metrics,
    nutrition,
    profile,
    progress_photos,
    readiness,
    sessions,
    settings,
    splits,
    stats,
    tools,
    workouts,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gym")


def _seed_exercises() -> None:
    """Seed the global exercise catalog if enabled. Never crashes boot."""
    from .seed.wger import seed_if_empty

    db = SessionLocal()
    try:
        seed_if_empty(db)
    except Exception as exc:  # noqa: BLE001 - boot must survive network errors
        logger.warning("Exercise seed skipped: %s", exc)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_settings()
    init_db()
    if cfg.jwt_is_default:
        logger.warning(
            "GYM_JWT_SECRET is using the insecure development default — "
            "set a strong secret in production!"
        )
    if cfg.seed_on_start:
        _seed_exercises()
    yield


app = FastAPI(title="gym-app API", version="0.1.0", lifespan=lifespan)

_cfg = get_settings()
# Every AI call is recorded (provider, model, outcome, latency) so the operator
# view can answer "is the AI working" without a hunt. See ai/telemetry.py.
app.middleware("http")(ai_telemetry.middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cfg.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
# Routers that serialize an exercise anywhere in their responses. The dependency
# publishes the caller's own catalog-image overrides for the request; without it
# they'd see the shared picture. Listed rather than applied globally because the
# auth router is partly unauthenticated (register/login) — `/auth/me/export`
# carries the dependency on its own route instead.
_SERIALIZES_EXERCISES = {exercises, workouts, splits, sessions, ai}
for module in (health, errors, auth, admin, exercises, exercise_media, workouts, splits, sessions, metrics, nutrition, settings, stats, profile, progress_photos, readiness, tools, ai):
    api.include_router(
        module.router,
        dependencies=[Depends(use_image_overrides)] if module in _SERIALIZES_EXERCISES else [],
    )
app.include_router(api)

# Tool-calling coach (companion extension). Mounted after the API routes so it
# can derive its tools from gym's own OpenAPI. /api/companion/chat.
from .ai import companion_setup  # noqa: E402

companion_setup.mount(app)
