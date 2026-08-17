"""A small, fixed exercise catalog for the e2e suite.

Locally the API starts from a copy of the dev database and already has the full
828-row wger catalog. CI has neither that file nor a reason to fetch one over
the network mid-run, so without this the catalog is *empty* — and an empty
catalog doesn't change what the suite is testing with, it stops several tests
from being able to run at all:

  - `07-account-and-ai` reads `/exercises?limit=1` and indexes [0]
  - `09-presets` adopts a program whose movements resolve against the catalog,
    and gets a plan of empty days
  - `13-csv` imports a Strong export naming real lifts, and matches none of them

The names below are exactly the vocabulary `api/app/presets.py` builds its
programs from, which is also where the CSV fixture's lifts come from. Seeded as
global rows (owner_id NULL) so they behave like the real catalog rather than
one account's custom movements.

Idempotent, and deliberately does nothing when a catalog is already present, so
running locally against the dev database copy is unaffected.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from app.db import SessionLocal, init_db
from app.models import Exercise

# (name, category, equipment, primary muscle, tracking type)
CATALOG: list[tuple[str, str, str, str, str]] = [
    ("Bench Press", "strength", "barbell", "chest", "weight_reps"),
    ("Incline Dumbbell Press", "strength", "dumbbell", "chest", "weight_reps"),
    ("Dumbbell Fly", "strength", "dumbbell", "chest", "weight_reps"),
    ("Cable Crossover", "strength", "cable", "chest", "weight_reps"),
    ("Overhead Press", "strength", "barbell", "shoulders", "weight_reps"),
    ("Lateral Raise", "strength", "dumbbell", "shoulders", "weight_reps"),
    ("Face Pull", "strength", "cable", "shoulders", "weight_reps"),
    ("Triceps Pushdown", "strength", "cable", "triceps", "weight_reps"),
    ("Barbell Row", "strength", "barbell", "back", "weight_reps"),
    ("Seated Cable Row", "strength", "cable", "back", "weight_reps"),
    ("Lat Pulldown", "strength", "cable", "back", "weight_reps"),
    ("Pull Up", "strength", "body only", "back", "bodyweight"),
    ("Deadlift", "strength", "barbell", "back", "weight_reps"),
    ("Romanian Deadlift", "strength", "barbell", "hamstrings", "weight_reps"),
    ("Barbell Curl", "strength", "barbell", "biceps", "weight_reps"),
    ("Hammer Curl", "strength", "dumbbell", "biceps", "weight_reps"),
    ("Squat", "strength", "barbell", "quadriceps", "weight_reps"),
    ("Front Squat", "strength", "barbell", "quadriceps", "weight_reps"),
    ("Leg Press", "strength", "machine", "quadriceps", "weight_reps"),
    ("Leg Extension", "strength", "machine", "quadriceps", "weight_reps"),
    ("Leg Curl", "strength", "machine", "hamstrings", "weight_reps"),
    ("Standing Calf Raise", "strength", "machine", "calves", "weight_reps"),
    ("Plank", "strength", "body only", "abdominals", "time"),
]


def main() -> int:
    init_db()
    with SessionLocal() as db:
        present = db.scalar(select(func.count()).select_from(Exercise)) or 0
        if present:
            print(f"catalog already has {present} rows; leaving it alone")
            return 0
        for name, category, equipment, muscle, tracking in CATALOG:
            db.add(
                Exercise(
                    name=name,
                    category=category,
                    equipment=equipment,
                    primary_muscles=[muscle],
                    secondary_muscles=[],
                    instructions=[f"{name} — seeded for the e2e suite."],
                    images=[],
                    is_custom=False,
                    tracking_type=tracking,
                    owner_id=None,
                )
            )
        db.commit()
        print(f"seeded {len(CATALOG)} exercises")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
