"""Deterministic training analysis over logged sets.

Volume, coverage, balance and strength trends are arithmetic, so they are
arithmetic here — the AI's job is to interpret the numbers, never to produce
them. Same argument as the progression nudge: a model that invents "you're at
14 sets for chest" is worse than no number at all.

Everything in this module is pure. The routes hand it plain dicts built from DB
rows so the maths can be tested without a database, and so a change to the
schema can't quietly change what a "hard set" means.
"""
from __future__ import annotations

# Warmups and drop sets don't count toward weekly volume — the landmarks below
# are all quoted in hard (working) sets.
_WORK_SET_TYPES = frozenset({"working", "normal"})

# A primary mover gets full credit, a secondary half: bench trains triceps, but
# not the way a triceps extension does. Half is the common convention and is
# deliberately crude — the useful signal is "nothing at all" vs "plenty".
_SECONDARY_CREDIT = 0.5

# Weekly hard sets per muscle: minimum effective, maximum adaptive, maximum
# recoverable. Mid-range figures from the usual hypertrophy literature; they are
# a starting point for a conversation, not a prescription, which is why the
# statuses read "under"/"productive"/"over" rather than pass/fail.
LANDMARKS: dict[str, tuple[int, int, int]] = {
    "chest": (8, 20, 26),
    "back": (10, 22, 28),
    "lats": (10, 22, 28),
    "shoulders": (8, 20, 26),
    "biceps": (8, 20, 26),
    "triceps": (6, 18, 24),
    "quadriceps": (8, 20, 26),
    "hamstrings": (6, 18, 24),
    "glutes": (6, 16, 22),
    "calves": (8, 18, 24),
    "abdominals": (6, 20, 26),
}

# Which muscles count toward each side of a balance ratio.
_RATIOS: list[tuple[str, tuple[str, ...], tuple[str, ...], float]] = [
    # (name, numerator muscles, denominator muscles, how far off is still fine)
    ("push:pull", ("chest", "shoulders", "triceps"), ("back", "lats", "biceps"), 0.4),
    ("quad:ham", ("quadriceps",), ("hamstrings", "glutes"), 0.5),
]


def _is_work_set(s: dict) -> bool:
    return (s.get("set_type") or "working") in _WORK_SET_TYPES


def hard_sets_by_muscle(entries: list[dict]) -> dict[str, float]:
    """Weekly-volume input: hard sets credited to each muscle.

    `entries` are `{"primary": [...], "secondary": [...], "sets": [...]}` — one
    per logged exercise. An exercise with no muscle tags contributes nothing
    rather than raising: the catalog has gaps, and a gap in the data must not
    take the screen down with it.
    """
    volume: dict[str, float] = {}
    for entry in entries:
        count = sum(1 for s in entry.get("sets", []) if _is_work_set(s))
        if not count:
            continue
        for muscle in entry.get("primary") or []:
            volume[muscle] = volume.get(muscle, 0.0) + count
        for muscle in entry.get("secondary") or []:
            volume[muscle] = volume.get(muscle, 0.0) + count * _SECONDARY_CREDIT
    return volume


def coverage(volume: dict[str, float], weeks: int = 1) -> list[dict]:
    """Each landmark muscle against its weekly range, hardest gap first.

    Muscles that were never trained are *included* with zero, because a muscle
    missing from the list is precisely the one that goes unnoticed.
    """
    weeks = max(1, weeks)
    rows: list[dict] = []
    for muscle, (mev, mav, mrv) in LANDMARKS.items():
        weekly = round(volume.get(muscle, 0.0) / weeks, 2)
        if weekly == 0:
            status = "missing"
        elif weekly < mev:
            status = "under"
        elif weekly > mrv:
            status = "over"
        else:
            status = "productive"
        rows.append(
            {
                "muscle": muscle,
                "weekly_sets": weekly,
                "mev": mev,
                "mav": mav,
                "mrv": mrv,
                "status": status,
            }
        )
    order = {"missing": 0, "under": 1, "over": 2, "productive": 3}
    rows.sort(key=lambda r: (order[r["status"]], r["weekly_sets"]))
    return rows


def balance_ratios(volume: dict[str, float]) -> list[dict]:
    """Push vs pull and quad vs hamstring, as ratios of hard sets.

    A side with no volume at all gives `ratio: None` rather than infinity — the
    honest reading is "there's nothing to compare", and it's already visible as
    a coverage gap.
    """
    out: list[dict] = []
    for name, top, bottom, tolerance in _RATIOS:
        a = sum(volume.get(m, 0.0) for m in top)
        b = sum(volume.get(m, 0.0) for m in bottom)
        ratio = round(a / b, 2) if b else None
        balanced = ratio is not None and abs(ratio - 1.0) <= tolerance
        out.append(
            {
                "name": name,
                "left": round(a, 2),
                "right": round(b, 2),
                "ratio": ratio,
                "balanced": balanced,
            }
        )
    return out


def e1rm(weight: float | None, reps: int | None) -> float | None:
    """Estimated one-rep max (Epley). None when the set isn't load x reps.

    Epley is within a couple of percent up to about five reps and drifts high
    after that; it's used here for *trend*, where the drift is constant and
    therefore cancels, not to tell anyone what to attempt.
    """
    if weight is None or reps is None or reps <= 0:
        return None
    # A single is a max by definition; the formula would inflate it by 3%.
    if reps == 1:
        return round(weight, 2)
    return round(weight * (1 + reps / 30), 2)


def tonnage(sets: list[dict]) -> float:
    """Total load moved in the working sets: sum of weight x reps."""
    total = 0.0
    for s in sets:
        if not _is_work_set(s):
            continue
        weight, reps = s.get("weight"), s.get("reps")
        if weight is None or reps is None:
            continue
        total += weight * reps
    return round(total, 2)


def trend_direction(series: list[float], threshold: float = 0.02) -> str:
    """"up" / "down" / "flat" over an oldest-first series.

    The threshold is what separates a plateau from progress: everyday noise in
    a logged e1RM is a percent or two, so a change smaller than that is not a
    direction of travel and shouldn't be reported as one.
    """
    points = [p for p in series if p is not None]
    if len(points) < 2:
        return "flat"
    first, last = points[0], points[-1]
    if first == 0:
        return "flat"
    change = (last - first) / abs(first)
    if change > threshold:
        return "up"
    if change < -threshold:
        return "down"
    return "flat"


# --- achievements ----------------------------------------------------------
#
# Derived, never granted. Every one of these is a restatement of what the log
# already says, which is what keeps them from becoming the point — you can't
# earn one by anything other than training. Deliberately few: a wall of sixty
# badges is noise, and what actually matters to a lifter is showing up, keeping
# it up, and lifting more than before.

ACHIEVEMENTS: list[dict] = [
    {"slug": "first-session", "name": "First session", "metric": "sessions", "target": 1,
     "blurb": "You started."},
    {"slug": "sessions-10", "name": "Ten sessions", "metric": "sessions", "target": 10,
     "blurb": "Past the point where most people stop."},
    {"slug": "sessions-50", "name": "Fifty sessions", "metric": "sessions", "target": 50,
     "blurb": "This is a habit now."},
    {"slug": "sessions-100", "name": "A hundred sessions", "metric": "sessions", "target": 100,
     "blurb": "Three figures."},
    {"slug": "streak-3", "name": "Three days running", "metric": "streak", "target": 3,
     "blurb": "Three consecutive days trained."},
    {"slug": "streak-7", "name": "A full week", "metric": "streak", "target": 7,
     "blurb": "Seven consecutive days trained."},
    {"slug": "tonnage-5k", "name": "Five tonnes", "metric": "tonnage", "target": 5_000,
     "blurb": "Total load moved across every set."},
    {"slug": "tonnage-100k", "name": "A hundred tonnes", "metric": "tonnage", "target": 100_000,
     "blurb": "Total load moved across every set."},
    {"slug": "first-pr", "name": "First PR", "metric": "prs", "target": 1,
     "blurb": "You beat a weight you'd already lifted."},
    {"slug": "prs-10", "name": "Ten PRs", "metric": "prs", "target": 10,
     "blurb": "Ten times heavier than before."},
]


def achievements(metrics: dict[str, float]) -> list[dict]:
    """Score every achievement against the athlete's own numbers.

    Unearned ones are returned *with their progress* rather than hidden: "7 of
    10" is motivating in a way a locked padlock isn't, and an empty screen is
    the worst thing to show someone who just logged their first session.
    """
    out = []
    for spec in ACHIEVEMENTS:
        value = metrics.get(spec["metric"], 0)
        out.append(
            {
                **spec,
                "progress": round(min(value, spec["target"]), 2),
                "earned": value >= spec["target"],
            }
        )
    return out


# --- readiness -------------------------------------------------------------
#
# Inferred from the log's own timing rather than from a wearable: when each
# muscle was last trained and how much it took that week. Deliberately coarse —
# this is "your legs were yesterday" and "your back hasn't been touched in ten
# days", not a recovery score pretending to be measured.

# Days of rest before a muscle is worth loading hard again. A rough consensus
# figure; individual recovery varies more than any table admits, which is why
# the output is advisory wording rather than a permission slip.
_RECOVERY_DAYS = 1.5
# Past this, the muscle isn't rested — it's been dropped from the plan.
_NEGLECTED_DAYS = 7.0


def readiness(
    days_since: dict[str, float], weekly_volume: dict[str, float], weeks: int = 1
) -> list[dict]:
    """Per-muscle recovery state, least recovered first.

    `days_since` is days since each muscle was last trained; `weekly_volume` is
    hard sets over the window, which is what lets a muscle read as overreached
    despite three days off — three days doesn't undo a week at 40 sets.
    """
    weeks = max(1, weeks)
    rows: list[dict] = []
    for muscle, (_mev, _mav, mrv) in LANDMARKS.items():
        since = days_since.get(muscle)
        weekly = round(weekly_volume.get(muscle, 0.0) / weeks, 2)

        if weekly > mrv:
            # Volume beats the clock: this is the one case where more rest is
            # the answer rather than another session.
            status = "overreached"
        elif since is None or since >= _NEGLECTED_DAYS:
            status = "neglected"
        elif since < _RECOVERY_DAYS:
            status = "recovering"
        else:
            status = "ready"

        rows.append(
            {
                "muscle": muscle,
                "days_since": round(since, 2) if since is not None else None,
                "weekly_sets": weekly,
                "status": status,
            }
        )

    # Least recovered first: what you shouldn't train today is more actionable
    # than what you could.
    order = {"recovering": 0, "overreached": 1, "neglected": 2, "ready": 3}
    rows.sort(key=lambda r: (order[r["status"]], r["days_since"] if r["days_since"] is not None else 999))
    return rows
