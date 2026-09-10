"""Sets out of a sentence, deterministically.

"bench 3x8 @60" is notation, not prose, and a gym log is mostly notation. The
rules here read the shapes people (and speech recognisers) actually produce:

    bench 3x8 @60            sets x reps at a load
    squats 5,5,5 @100        one set per rep entry
    Bench press — 95 10, 90 11   load-reps pairs, notes-app style
    pull ups 3x8             no load
    ohp 4 sets of 6 at 40    the spoken form of "x"
    bench three by eight at sixty   what a recogniser hands back

Several exercises are separated by a newline, ";", or the word "then". Words
after the last set that aren't notation become the item's note ("last set
hard"). Anything the rules don't recognise is left alone rather than guessed:
the caller falls back to the model for prose, so a wrong guess here would be
worse than no answer.

Output is the same shape as the model's (`ai.base.ParsedExercise`) so the
catalog matcher and every screen downstream can't tell which read it.
"""
from __future__ import annotations

import re

_UNITS = {"kg", "kgs", "kilo", "kilos", "kilograms", "lb", "lbs", "pounds"}

_SMALL = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}


def _words_to_digits(text: str) -> str:
    """"one hundred and twenty" -> "120", "twenty five" -> "25", "by" -> "x".

    Only runs of number words are touched, so an exercise called "Twenty-One
    Curls" still loses its name — an accepted cost for "three by eight".
    """
    toks = re.split(r"(\s+)", text)
    out: list[str] = []
    i = 0
    while i < len(toks):
        tok = toks[i]
        low = tok.lower().strip(",.")
        if low in _SMALL or low in _TENS or low == "hundred":
            total = 0
            current = 0
            j = i
            consumed_any = False
            while j < len(toks):
                w = toks[j].lower().strip(",.")
                if w in _SMALL:
                    current += _SMALL[w]
                elif w in _TENS:
                    current += _TENS[w]
                elif w == "hundred":
                    current = (current or 1) * 100
                elif w == "and" and consumed_any:
                    pass
                elif toks[j].strip() == "":
                    pass  # whitespace between number words
                else:
                    break
                if toks[j].strip():
                    consumed_any = True
                j += 1
            # Don't swallow a trailing "and" that belonged to the next phrase.
            while j > i and toks[j - 1].strip().lower().strip(",.") in ("and", ""):
                j -= 1
            total = current
            out.append(str(total))
            i = j
            continue
        out.append(tok)
        i += 1
    joined = "".join(out)
    joined = re.sub(r"\bby\b", "x", joined, flags=re.I)
    joined = re.sub(r"\bsets?\s+of\b", "x", joined, flags=re.I)
    return joined


_NUM = r"\d+(?:\.\d+)?"
_LOAD = rf"(?:\s*(?:@|at)\s*|\s+)({_NUM})\s*(?:kg|kgs|kilos?|kilograms|lbs?|pounds)?"
_RPE = r"(?:\s*,?\s*(?:@\s*)?rpe\s*(\d+(?:\.\d+)?))?"

# sets x reps [@ load] [rpe n]
_SXR = re.compile(rf"(\d+)\s*[x×*]\s*(\d+)(?:{_LOAD})?{_RPE}", re.I)
# reps, reps, reps [@ load]
_LIST = re.compile(rf"(\d+(?:\s*,\s*\d+)+)(?:{_LOAD})?{_RPE}", re.I)
# load reps, load reps  (notes-app style: "95 10, 90 11")
_PAIRS = re.compile(rf"({_NUM})\s+(\d+)((?:\s*,\s*{_NUM}\s+\d+)*)", re.I)


def _set(reps: int, weight: float | None, rpe: float | None = None) -> dict:
    return {"reps": reps, "weight": weight, "rpe": rpe, "set_type": "working"}


def _clean_name(raw: str) -> str:
    name = raw.strip()
    name = re.sub(r"[\s\-–—:]+$", "", name)
    return name.strip()


def _clean_note(raw: str) -> str | None:
    note = raw.strip().strip(",;.-–— ").strip()
    return note or None


def _parse_segment(seg: str) -> dict | None:
    seg = seg.strip()
    if not seg:
        return None
    seg = _words_to_digits(seg)

    m = _SXR.search(seg)
    if m and _clean_name(seg[: m.start()]):
        sets_n, reps = int(m.group(1)), int(m.group(2))
        weight = float(m.group(3)) if m.group(3) else None
        rpe = float(m.group(4)) if m.group(4) else None
        if sets_n <= 0 or sets_n > 30:
            return None
        return {
            "exercise": _clean_name(seg[: m.start()]),
            "sets": [_set(reps, weight, rpe) for _ in range(sets_n)],
            "notes": _clean_note(seg[m.end():]),
        }

    m = _PAIRS.search(seg)
    if m and _clean_name(seg[: m.start()]):
        pairs = re.findall(rf"({_NUM})\s+(\d+)", m.group(0))
        return {
            "exercise": _clean_name(seg[: m.start()]),
            "sets": [_set(int(r), float(w)) for w, r in pairs],
            "notes": _clean_note(seg[m.end():]),
        }
    m = _LIST.search(seg)
    if m and _clean_name(seg[: m.start()]):
        reps = [int(r) for r in re.split(r"\s*,\s*", m.group(1))]
        weight = float(m.group(2)) if m.group(2) else None
        rpe = float(m.group(3)) if m.group(3) else None
        return {
            "exercise": _clean_name(seg[: m.start()]),
            "sets": [_set(r, weight, rpe) for r in reps],
            "notes": _clean_note(seg[m.end():]),
        }

    return None


def parse_sets_text(text: str) -> list[dict]:
    """Every exercise the notation in `text` describes, in order. Empty when
    nothing in it is notation — that is the signal to try the model."""
    items: list[dict] = []
    for seg in re.split(r"\n|;|\bthen\b", text or "", flags=re.I):
        item = _parse_segment(seg)
        if item:
            items.append(item)
    return items


def _is_header(line: str) -> bool:
    """A day header: a line with no set notation and at most a date in it."""
    return _parse_segment(line) is None and not re.search(r"\d+\s*[x×*]\s*\d+", line)


def parse_days_text(text: str) -> list[dict]:
    """Split a multi-day paste on its headers: a line that carries no sets
    starts a new day and becomes its label. A paste with no header at all is
    one day with no label."""
    days: list[dict] = []
    current: dict | None = None
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if _is_header(line):
            current = {"day": line, "exercises": []}
            days.append(current)
            continue
        item = _parse_segment(line)
        if item is None:
            continue
        if current is None:
            current = {"day": None, "exercises": []}
            days.append(current)
        current["exercises"].append(item)
    return [d for d in days if d["exercises"]]
