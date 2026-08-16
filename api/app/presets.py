"""Well-known training programs, as data.

Two consumers, one library, and that's the point:

1. **The athlete** picks one at onboarding or from Splits and gets a credible
   plan without building or pasting anything.
2. **The spotter** reads them as grounding. Generation currently invents
   structure from scratch; a shelf of known-good programs gives it real
   templates to adapt ("this is PPL with your equipment") instead of
   freelancing.

Exercises are named in plain English and resolved against the catalog at adopt
time by the same matcher used everywhere else — hard-coding catalog ids here
would break the moment the catalog is reseeded, and these names are the ones a
person would say anyway.

Nothing here is a live link: adopting copies. What you adopt is yours to edit,
and the preset never changes under you.
"""
from __future__ import annotations

from typing import Any

# (name, sets, rep low, rep high) — rep ranges, because every plan in this app
# progresses by clearing the top of one.
Movement = tuple[str, int, int, int]


def _day(name: str, weekdays: list[int], movements: list[Movement]) -> dict[str, Any]:
    return {
        "name": name,
        "weekdays": weekdays,
        "exercises": [
            {"exercise": m[0], "target_sets": m[1], "target_reps": m[2], "target_reps_max": m[3]}
            for m in movements
        ],
    }


PRESETS: list[dict[str, Any]] = [
    {
        "slug": "ppl",
        "name": "Push / Pull / Legs",
        "description": (
            "The classic three-way rotation. Run it as a cycle and rest whenever you "
            "need to — three days a week at a minimum, six if you repeat it."
        ),
        "level": "intermediate",
        "days_per_week": 3,
        # A cycle, not a week: adopting it must not invent weekdays.
        "mode": "rolling",
        "days": [
            _day("Push", [], [
                ("Bench Press", 4, 6, 8),
                ("Overhead Press", 3, 8, 10),
                ("Incline Dumbbell Press", 3, 8, 12),
                ("Lateral Raise", 3, 12, 15),
                ("Triceps Pushdown", 3, 10, 15),
            ]),
            _day("Pull", [], [
                ("Deadlift", 3, 5, 5),
                ("Pull Up", 3, 6, 10),
                ("Barbell Row", 3, 8, 10),
                ("Face Pull", 3, 12, 15),
                ("Barbell Curl", 3, 10, 12),
            ]),
            _day("Legs", [], [
                ("Squat", 4, 6, 8),
                ("Romanian Deadlift", 3, 8, 10),
                ("Leg Press", 3, 10, 12),
                ("Leg Curl", 3, 10, 15),
                ("Standing Calf Raise", 4, 12, 15),
            ]),
        ],
    },
    {
        "slug": "upper-lower",
        "name": "Upper / Lower",
        "description": (
            "Four days a week, alternating upper and lower body. The usual "
            "recommendation when three full-body days stop being enough."
        ),
        "level": "intermediate",
        "days_per_week": 4,
        "mode": "rigid",
        "days": [
            _day("Upper A", [1], [
                ("Bench Press", 4, 5, 8),
                ("Barbell Row", 4, 6, 10),
                ("Overhead Press", 3, 8, 10),
                ("Lat Pulldown", 3, 10, 12),
                ("Barbell Curl", 3, 10, 12),
            ]),
            _day("Lower A", [2], [
                ("Squat", 4, 5, 8),
                ("Romanian Deadlift", 3, 8, 10),
                ("Leg Press", 3, 10, 12),
                ("Standing Calf Raise", 4, 12, 15),
                ("Plank", 3, 1, 1),
            ]),
            _day("Upper B", [4], [
                ("Overhead Press", 4, 5, 8),
                ("Pull Up", 4, 6, 10),
                ("Incline Dumbbell Press", 3, 8, 12),
                ("Seated Cable Row", 3, 10, 12),
                ("Triceps Pushdown", 3, 10, 15),
            ]),
            _day("Lower B", [5], [
                ("Deadlift", 3, 3, 5),
                ("Front Squat", 3, 6, 8),
                ("Leg Curl", 3, 10, 15),
                ("Leg Extension", 3, 12, 15),
                ("Standing Calf Raise", 4, 12, 15),
            ]),
        ],
    },
    {
        "slug": "full-body-3x",
        "name": "Full Body 3x",
        "description": (
            "Three full-body days a week. The most training you can get from the "
            "least time in the gym, and the usual starting point."
        ),
        "level": "beginner",
        "days_per_week": 3,
        "mode": "rigid",
        "days": [
            _day("Full Body A", [1], [
                ("Squat", 3, 5, 8),
                ("Bench Press", 3, 5, 8),
                ("Barbell Row", 3, 6, 10),
                ("Plank", 3, 1, 1),
            ]),
            _day("Full Body B", [3], [
                ("Deadlift", 3, 3, 5),
                ("Overhead Press", 3, 5, 8),
                ("Lat Pulldown", 3, 8, 12),
                ("Leg Curl", 3, 10, 15),
            ]),
            _day("Full Body C", [5], [
                ("Front Squat", 3, 6, 8),
                ("Incline Dumbbell Press", 3, 8, 12),
                ("Seated Cable Row", 3, 8, 12),
                ("Standing Calf Raise", 3, 12, 15),
            ]),
        ],
    },
    {
        "slug": "starting-strength",
        "name": "Starting Strength",
        "description": (
            "Two alternating full-body days built on the barbell lifts, three times "
            "a week. Add weight every session for as long as it keeps working."
        ),
        "level": "beginner",
        "days_per_week": 3,
        "mode": "rolling",  # A/B alternate; the calendar doesn't decide which
        "days": [
            _day("Workout A", [], [
                ("Squat", 3, 5, 5),
                ("Bench Press", 3, 5, 5),
                ("Deadlift", 1, 5, 5),
            ]),
            _day("Workout B", [], [
                ("Squat", 3, 5, 5),
                ("Overhead Press", 3, 5, 5),
                ("Barbell Row", 3, 5, 5),
            ]),
        ],
    },
    {
        "slug": "stronglifts-5x5",
        "name": "StrongLifts 5x5",
        "description": (
            "Five sets of five on two alternating days. Same idea as Starting "
            "Strength with more volume per lift."
        ),
        "level": "beginner",
        "days_per_week": 3,
        "mode": "rolling",
        "days": [
            _day("Workout A", [], [
                ("Squat", 5, 5, 5),
                ("Bench Press", 5, 5, 5),
                ("Barbell Row", 5, 5, 5),
            ]),
            _day("Workout B", [], [
                ("Squat", 5, 5, 5),
                ("Overhead Press", 5, 5, 5),
                ("Deadlift", 1, 5, 5),
            ]),
        ],
    },
    {
        "slug": "arnold",
        "name": "Arnold Split",
        "description": (
            "Chest+back, shoulders+arms, legs — six days a week, each pairing twice. "
            "High volume; it assumes you can recover from it."
        ),
        "level": "advanced",
        "days_per_week": 6,
        "mode": "rolling",
        "days": [
            _day("Chest & Back", [], [
                ("Bench Press", 4, 8, 10),
                ("Incline Dumbbell Press", 4, 8, 12),
                ("Pull Up", 4, 6, 10),
                ("Barbell Row", 4, 8, 10),
                ("Dumbbell Fly", 3, 12, 15),
            ]),
            _day("Shoulders & Arms", [], [
                ("Overhead Press", 4, 6, 10),
                ("Lateral Raise", 4, 12, 15),
                ("Barbell Curl", 4, 8, 12),
                ("Triceps Pushdown", 4, 10, 15),
                ("Hammer Curl", 3, 10, 12),
            ]),
            _day("Legs", [], [
                ("Squat", 5, 6, 10),
                ("Leg Press", 4, 10, 12),
                ("Leg Curl", 4, 10, 15),
                ("Standing Calf Raise", 5, 12, 20),
            ]),
        ],
    },
    {
        "slug": "bro-split",
        "name": "Body Part Split",
        "description": (
            "One muscle group a day, five days a week. Not the most efficient way "
            "to train, but easy to follow and easy to enjoy."
        ),
        "level": "intermediate",
        "days_per_week": 5,
        "mode": "rigid",
        "days": [
            _day("Chest", [1], [
                ("Bench Press", 4, 8, 10),
                ("Incline Dumbbell Press", 3, 8, 12),
                ("Cable Crossover", 3, 12, 15),
            ]),
            _day("Back", [2], [
                ("Deadlift", 3, 5, 8),
                ("Pull Up", 3, 6, 10),
                ("Seated Cable Row", 3, 10, 12),
            ]),
            _day("Shoulders", [3], [
                ("Overhead Press", 4, 8, 10),
                ("Lateral Raise", 4, 12, 15),
                ("Face Pull", 3, 12, 15),
            ]),
            _day("Legs", [4], [
                ("Squat", 4, 8, 10),
                ("Leg Press", 3, 10, 12),
                ("Leg Curl", 3, 10, 15),
                ("Standing Calf Raise", 4, 12, 20),
            ]),
            _day("Arms", [5], [
                ("Barbell Curl", 4, 8, 12),
                ("Triceps Pushdown", 4, 10, 15),
                ("Hammer Curl", 3, 10, 12),
            ]),
        ],
    },
]

_BY_SLUG = {p["slug"]: p for p in PRESETS}

# Progression rules copied onto an adopted split, so the plan states its own
# rule the way a hand-built one does — and so the progression nudge and the
# next-session targets have something to agree with.
DEFAULT_RULES = [
    "Add weight when you hit the top of the rep range on every working set.",
    "Keep the same weight until you do.",
]


def get(slug: str) -> dict[str, Any] | None:
    return _BY_SLUG.get(slug)


def summaries() -> list[dict[str, Any]]:
    """The library as the picker shows it — everything except the exercises."""
    return [
        {k: v for k, v in preset.items() if k != "days"}
        | {"days": [{"name": d["name"], "exercises": d["exercises"]} for d in preset["days"]]}
        for preset in PRESETS
    ]
