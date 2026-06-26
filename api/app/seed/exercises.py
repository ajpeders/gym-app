"""Import the free-exercise-db dataset into the local database.

Idempotent: skips items already present (matched by external_id). Can run on
startup (wrapped in try/except by the caller) or standalone:

    python -m app.seed.exercises
"""
from __future__ import annotations

import logging

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import SessionLocal, init_db
from ..models import Exercise

logger = logging.getLogger("gym.seed")

DATA_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
IMAGE_BASE = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/"


def _full_image_url(path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return IMAGE_BASE + path.lstrip("/")


def fetch_dataset(timeout: float = 30.0) -> list[dict]:
    resp = httpx.get(DATA_URL, timeout=timeout, follow_redirects=True)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError("Unexpected dataset shape (expected a JSON array)")
    return data


def import_exercises(db: Session, items: list[dict]) -> int:
    """Upsert exercises by external_id. Returns the number newly inserted."""
    existing = {
        row[0]
        for row in db.execute(
            select(Exercise.external_id).where(Exercise.external_id.is_not(None))
        )
    }
    inserted = 0
    for item in items:
        ext_id = item.get("id")
        if ext_id and ext_id in existing:
            continue
        ex = Exercise(
            external_id=ext_id,
            name=item.get("name") or "Unknown",
            category=item.get("category"),
            force=item.get("force"),
            level=item.get("level"),
            mechanic=item.get("mechanic"),
            equipment=item.get("equipment"),
            primary_muscles=item.get("primaryMuscles") or [],
            secondary_muscles=item.get("secondaryMuscles") or [],
            instructions=item.get("instructions") or [],
            images=[_full_image_url(p) for p in (item.get("images") or [])],
            is_custom=False,
            owner_id=None,
        )
        db.add(ex)
        if ext_id:
            existing.add(ext_id)
        inserted += 1
    db.commit()
    return inserted


def seed_if_empty(db: Session) -> int:
    """Fetch + import the global exercise catalog only if the table is empty.

    Returns the number of inserted rows (0 if already seeded). Network/parse
    errors propagate to the caller, which decides whether to swallow them.
    """
    count = db.scalar(select(func.count()).select_from(Exercise))
    if count and count > 0:
        logger.info("Exercises already present (%s rows); skipping seed", count)
        return 0
    logger.info("Seeding exercises from %s", DATA_URL)
    items = fetch_dataset()
    inserted = import_exercises(db, items)
    logger.info("Seeded %s exercises", inserted)
    return inserted


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    init_db()
    db = SessionLocal()
    try:
        inserted = seed_if_empty(db)
        print(f"Inserted {inserted} exercises")
    finally:
        db.close()


if __name__ == "__main__":
    main()
