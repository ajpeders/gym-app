"""Cycle position for rolling splits.

A rolling split is an ordered rotation with no dates on it — Push/Pull/Legs,
rest whenever. Position therefore can't come from the calendar; it comes from
what was logged. Both functions take the rotation (workout ids in split order)
and the workout ids of recent sessions, most recent first.

The unit of "now" is the *current pass*: the streak of distinct workouts most
recently logged. Walking backwards until a workout repeats makes the cycle
reset itself — coming round to a day you've already done starts a new pass —
so nothing here needs a week boundary, which is exactly what a rolling split
drifts across by design.
"""
from __future__ import annotations


def done_this_cycle(rotation: list[int], recent_first: list[int]) -> set[int]:
    """Workouts already done in the current pass through the rotation.

    Empty when the pass just completed: every day done means the next log
    starts a fresh cycle, not that the split is finished forever.
    """
    ring = [w for w in rotation if w is not None]
    if not ring:
        return set()
    # A pass walks forward through the ring, so scanning backwards it must see
    # strictly decreasing positions. Anything else — a repeat, or a later day
    # from the pass before — is on the far side of the boundary. Plain
    # "distinct until it repeats" gets this wrong: Push,Pull,Legs,Push,Pull has
    # three distinct workouts in a row but only Push,Pull in the current pass.
    done: list[int] = []
    limit = len(ring)
    for wid in recent_first:
        if wid not in ring:  # a since-deleted day can't hold a cycle position
            continue
        pos = ring.index(wid)
        if pos >= limit:
            break
        done.append(wid)
        limit = pos
    if len(done) == len(ring):
        return set()
    return set(done)


def up_next(rotation: list[int], recent_first: list[int]) -> int | None:
    """The workout that comes up next, or None if the split has no days.

    Normally the successor of the last thing logged. When days were logged out
    of order, the successor may already be done this pass, so this walks the
    ring from there and returns the first day still outstanding.
    """
    ring = [w for w in rotation if w is not None]
    if not ring:
        return None
    last = next((w for w in recent_first if w in ring), None)
    start = 0 if last is None else (ring.index(last) + 1) % len(ring)
    done = done_this_cycle(ring, recent_first)
    for offset in range(len(ring)):
        candidate = ring[(start + offset) % len(ring)]
        if candidate not in done:
            return candidate
    return ring[start]
