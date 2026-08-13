"""Double progression: the rule every plan in this app already states.

"When you hit the top of the rep range for all sets, increase weight next
time." The plan snapshot on a session_exercise carries the target, the logged
sets carry the reps, so whether you earned the jump is derivable — nothing is
stored.

Deliberately strict. A nudge that fires when you didn't actually clear the
range trains you to ignore it, so every working set must reach the top and the
planned number of sets must actually be done.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol


class SetLike(Protocol):
    reps: int | None
    set_type: str
    completed: bool


# What counts as a work set. 'working' is what the live screen writes and
# 'normal' is what /sessions/log writes; warmups, drop sets and a set taken to
# failure are all deliberate departures from the target and must not veto it.
_WORK_SET_TYPES = frozenset({"working", "normal"})


def cleared_rep_range(
    target_sets: int | None,
    target_reps_max: int | None,
    sets: Iterable[Any],
) -> bool:
    """True when every work set reached the top of the planned rep range."""
    if target_reps_max is None:
        return False
    work = [
        s
        for s in sets
        if s.set_type in _WORK_SET_TYPES and s.completed and s.reps is not None
    ]
    if not work:
        return False
    if target_sets is not None and len(work) < target_sets:
        return False
    return all(s.reps >= target_reps_max for s in work)
