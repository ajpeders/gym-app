"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import SessionLocal, init_db
from .routes import (
    ai,
    auth,
    exercises,
    health,
    metrics,
    routines,
    settings,
    stats,
    workouts,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gym")


def _seed_exercises() -> None:
    """Seed the global exercise catalog if enabled. Never crashes boot."""
    from .seed.exercises import seed_if_empty

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
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cfg.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")
for module in (health, auth, exercises, routines, workouts, metrics, settings, stats, ai):
    api.include_router(module.router)
app.include_router(api)
