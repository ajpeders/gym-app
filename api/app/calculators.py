"""Gym-floor arithmetic: plates, warmups, and estimated maxes.

Pure functions, no network, no model. This is the maths you'd otherwise do in
your head between sets, and doing it wrong costs a set — which is exactly why
none of it should depend on anything being reachable.
"""
from __future__ import annotations

from .analysis import e1rm

# Standard gym sets. Kilograms by default; the pound plates are here so a
# caller with `units == "lb"` doesn't have to invent them.
KG_PLATES = [25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25]
LB_PLATES = [45.0, 35.0, 25.0, 10.0, 5.0, 2.5]

# Fractions of the working weight to ramp through, with the reps that go with
# them. Standard practice: enough to groove the movement, not enough to fatigue.
_RAMP = [(0.4, 8), (0.6, 5), (0.8, 3), (0.9, 1)]

# Below this multiple of the bar, a full four-step ramp is longer than the
# working sets it's warming up for.
_SHORT_RAMP_BELOW = 3.0


def plate_breakdown(
    target: float, bar: float = 20.0, plates: list[float] | None = None
) -> dict:
    """What to hang on each side of the bar for `target`.

    Greedy heaviest-first, which is both optimal for real plate sets and the
    order you physically load them. A weight the plates can't make comes back
    as the nearest achievable one plus what's left over, rather than an error:
    "102.5, and you're 1kg short" is useful; a failure is not.
    """
    available = sorted(plates or KG_PLATES, reverse=True)
    if target <= bar:
        return {
            "target": target,
            "bar": bar,
            "per_side": [],
            "achievable": bar,
            "leftover": 0.0,
            "below_bar": target < bar,
        }

    per_side_needed = (target - bar) / 2
    remaining = per_side_needed
    per_side: list[float] = []
    for plate in available:
        # A hair of tolerance: 0.1 of a plate can't be loaded anyway, and float
        # subtraction leaves dust that would otherwise add a phantom 1.25.
        while remaining >= plate - 1e-9:
            per_side.append(plate)
            remaining -= plate

    loaded = sum(per_side)
    return {
        "target": target,
        "bar": bar,
        "per_side": [int(p) if float(p).is_integer() else p for p in per_side],
        "achievable": round(bar + loaded * 2, 2),
        "leftover": round(remaining * 2, 2),
        "below_bar": False,
    }


def warmup_sets(
    working_weight: float, bar: float = 20.0, plates: list[float] | None = None
) -> list[dict]:
    """A ramp from the bar to just under the working weight.

    Every step is rounded down to something the plates can actually make — a
    warmup you can't load is a warmup you'll skip — and duplicates are dropped,
    which is what keeps a light working weight from getting a four-set ramp to
    reach it.
    """
    if working_weight <= bar:
        return []

    available = plates or KG_PLATES
    smallest_step = min(available) * 2  # both sides
    # Everyone starts with the empty bar, and it's where the movement gets
    # grooved — so it's a set, not an assumption.
    out: list[dict] = [{"weight": bar, "reps": 10}]
    seen: set[float] = {bar}

    ramp = _RAMP if working_weight >= bar * _SHORT_RAMP_BELOW else _RAMP[-1:]
    for fraction, reps in ramp:
        raw = working_weight * fraction
        if raw <= bar:
            weight = bar
        else:
            # Round down to a loadable weight.
            steps = int((raw - bar) / smallest_step)
            weight = round(bar + steps * smallest_step, 2)
        # Steps have to be worth taking: a jump of one small plate from the
        # last one is a rep of theatre, not a warmup.
        if weight >= working_weight or weight < max(seen) + smallest_step * 2:
            continue
        seen.add(weight)
        out.append({"weight": weight, "reps": reps})

    return out


def one_rep_max(weight: float | None, reps: int | None) -> dict | None:
    """Estimated max plus the percentage table people actually train off.

    Shares `analysis.e1rm` rather than repeating Epley, so the number here and
    the number on the strength trend can't drift apart.
    """
    estimate = e1rm(weight, reps)
    if estimate is None:
        return None
    return {
        "estimate": estimate,
        "percentages": {f"{pct}%": round(estimate * pct / 100, 2) for pct in range(95, 45, -5)},
    }
