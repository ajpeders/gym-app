"""Turn "you cleared the range" into a concrete target for next time.

`progression.cleared_rep_range` decides whether the jump was earned; this says
what the jump *is*. They deliberately share the rule, so the badge on the
session screen and the number on the plan can never disagree.

The increments are equipment-shaped because advice you can't follow is worse
than none: a plate-loaded stack doesn't do 2.5kg, and a pair of dumbbells moves
in 2kg-per-hand steps. Where there's no load to add — bodyweight, timed holds —
progression is reps or seconds instead.
"""
from __future__ import annotations

_WORK_SET_TYPES = frozenset({"working", "normal"})

# kg added when the rep range is cleared, by the exercise's equipment tag.
_INCREMENT = {
    "barbell": 2.5,
    "ez curl bar": 2.5,
    "cable": 2.5,
    "dumbbell": 4.0,  # 2kg per hand, the usual smallest pair jump
    "kettlebells": 4.0,
    "machine": 5.0,  # a stack pin, not a plate
    "smith machine": 5.0,
}
_DEFAULT_INCREMENT = 2.5


def _work_sets(sets: list[dict]) -> list[dict]:
    return [s for s in sets if (s.get("set_type") or "working") in _WORK_SET_TYPES]


def _increment_for(equipment: str | None) -> float:
    return _INCREMENT.get((equipment or "").strip().lower(), _DEFAULT_INCREMENT)


def suggest_next(target: dict, last_sets: list[dict]) -> dict:
    """What to aim for next time on one exercise.

    `target` is the plan's snapshot (`target_sets`, `target_reps`,
    `target_reps_max`, optional `target_duration_seconds*` and `equipment`);
    `last_sets` are the most recent session's sets for it.

    Returns `{action, weight, reps, duration_seconds, reason}` where action is
    one of start / repeat / add_weight / add_reps / add_time.
    """
    work = _work_sets(last_sets)
    target_sets = target.get("target_sets")
    reps_low = target.get("target_reps")
    reps_top = target.get("target_reps_max") or reps_low
    hold_low = target.get("target_duration_seconds")
    hold_top = target.get("target_duration_seconds_max") or hold_low

    if not work:
        return {
            "action": "start",
            "weight": None,
            "reps": reps_low,
            "duration_seconds": hold_low,
            "reason": "Nothing logged for this yet — start at the plan's target.",
        }

    enough_sets = target_sets is None or len(work) >= target_sets

    # A timed hold progresses in seconds; there's no rep range to clear.
    if hold_top is not None and all(s.get("duration_seconds") is not None for s in work):
        best = max(s["duration_seconds"] for s in work)
        if enough_sets and all(s["duration_seconds"] >= hold_top for s in work):
            return {
                "action": "add_time",
                "weight": None,
                "reps": None,
                "duration_seconds": best + 5,
                "reason": f"Held {hold_top}s on every set — add 5s.",
            }
        return {
            "action": "repeat",
            "weight": None,
            "reps": None,
            "duration_seconds": hold_top,
            "reason": f"Work back up to {hold_top}s on every set.",
        }

    cleared = (
        reps_top is not None
        and enough_sets
        and all(s.get("reps") is not None and s["reps"] >= reps_top for s in work)
    )

    loaded = [s for s in work if s.get("weight") is not None]
    # Progress from the heaviest working set, not the last one: sets logged at
    # mixed loads are common (a back-off set is still a work set), and the top
    # one is what was actually earned.
    best_weight = max((s["weight"] for s in loaded), default=None)

    if not cleared:
        return {
            "action": "repeat",
            "weight": best_weight,
            "reps": reps_top,
            "duration_seconds": None,
            "reason": (
                f"Hit {reps_top} on every set at this weight to earn the jump."
                if reps_top
                else "Repeat this session's target."
            ),
        }

    if best_weight is None:
        # Bodyweight: there's no load to add, so the reps go up instead.
        best_reps = max(s["reps"] for s in work if s.get("reps") is not None)
        return {
            "action": "add_reps",
            "weight": None,
            "reps": best_reps + 1,
            "duration_seconds": None,
            "reason": f"Cleared {reps_top} on every set — add a rep.",
        }

    step = _increment_for(target.get("equipment"))
    return {
        "action": "add_weight",
        "weight": round(best_weight + step, 2),
        # Back to the bottom of the range at the new load — that's what makes it
        # double progression rather than a permanent grind at the top.
        "reps": reps_low,
        "duration_seconds": None,
        "reason": f"Cleared {reps_top} on every set — add {step}kg.",
    }
