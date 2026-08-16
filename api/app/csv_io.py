"""Read a training history out of Hevy or Strong, and write one back out.

Easy to bring a whole training life in is half the moat (the other half being
that the memory makes it costly to leave). Both apps export CSV, both name
their columns differently, and neither will change for us — so the header row
decides which reader to use and everything downstream sees one shape.

No model anywhere near this. A CSV is structured data: asking an LLM to read
one would be slower, more expensive, and less reliable than reading it.
"""
from __future__ import annotations

import csv
import io
from typing import Any

# Header fingerprints. Matching on a couple of distinctive columns rather than
# the whole row, because both apps add columns between versions.
_HEVY_MARKERS = {"exercise_title", "start_time"}
_STRONG_MARKERS = {"exercise name", "date"}

# Both apps distinguish warmups; importing them as working sets would inflate
# every volume figure downstream.
_WARMUP_LABELS = {"warmup", "warm up", "warm-up"}
_DROP_LABELS = {"drop", "dropset", "drop set"}


def _headers(text: str) -> list[str]:
    line = text.lstrip().splitlines()[0] if text.strip() else ""
    return [h.strip().strip('"').lower() for h in next(csv.reader([line]), [])]


def detect_format(text: str) -> str | None:
    """"hevy" / "strong" / None. None means "this isn't a training export"."""
    headers = set(_headers(text))
    if _HEVY_MARKERS <= headers:
        return "hevy"
    if _STRONG_MARKERS <= headers:
        return "strong"
    return None


def _number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _int(value: Any) -> int | None:
    number = _number(value)
    return None if number is None else int(number)


def _set_type(raw: str | None) -> str:
    label = (raw or "").strip().lower()
    if label in _WARMUP_LABELS:
        return "warmup"
    if label in _DROP_LABELS:
        return "drop"
    return "working"


def parse_rows(text: str) -> list[dict]:
    """One normalised row per set, in file order.

    Rows that name no exercise are skipped: both exporters emit blank spacer
    rows, and a set belonging to nothing can't be imported anywhere.
    """
    fmt = detect_format(text)
    if fmt is None:
        return []

    reader = csv.DictReader(io.StringIO(text))
    out: list[dict] = []
    for raw in reader:
        row = { (k or "").strip().lower(): v for k, v in raw.items() }
        if fmt == "hevy":
            normalised = {
                "workout": (row.get("title") or "").strip(),
                "started_at": (row.get("start_time") or "").strip(),
                "exercise": (row.get("exercise_title") or "").strip(),
                "set_type": _set_type(row.get("set_type")),
                "weight": _number(row.get("weight_kg")),
                "reps": _int(row.get("reps")),
                "rpe": _number(row.get("rpe")),
                "duration_seconds": _int(row.get("duration_seconds")),
                "notes": (row.get("exercise_notes") or "").strip() or None,
            }
        else:
            normalised = {
                "workout": (row.get("workout name") or "").strip(),
                "started_at": (row.get("date") or "").strip(),
                "exercise": (row.get("exercise name") or "").strip(),
                "set_type": _set_type(row.get("set type")),
                "weight": _number(row.get("weight")),
                "reps": _int(row.get("reps")),
                "rpe": _number(row.get("rpe")),
                "duration_seconds": _int(row.get("seconds")),
                "notes": (row.get("notes") or "").strip() or None,
            }
        if not normalised["exercise"]:
            continue
        out.append(normalised)
    return out


def sessions_from_rows(rows: list[dict]) -> list[dict]:
    """Group normalised rows into sessions, preserving the file's order.

    Grouped by start time rather than by workout name: two "Push" days a week
    apart are two sessions, and the timestamp is the only thing both exporters
    agree identifies a bout.
    """
    sessions: list[dict] = []
    by_time: dict[str, dict] = {}

    for row in rows:
        # A set with neither load nor reps nor time is a spacer, not a set.
        if row["reps"] is None and row["weight"] is None and row["duration_seconds"] is None:
            continue

        key = row["started_at"] or row["workout"]
        session = by_time.get(key)
        if session is None:
            session = {
                "name": row["workout"] or "Imported session",
                "started_at": row["started_at"],
                "exercises": [],
                "_by_exercise": {},
            }
            by_time[key] = session
            sessions.append(session)

        exercise = session["_by_exercise"].get(row["exercise"])
        if exercise is None:
            exercise = {"exercise": row["exercise"], "notes": row["notes"], "sets": []}
            session["_by_exercise"][row["exercise"]] = exercise
            session["exercises"].append(exercise)

        exercise["sets"].append(
            {
                "reps": row["reps"],
                "weight": row["weight"],
                "rpe": row["rpe"],
                "duration_seconds": row["duration_seconds"],
                "set_type": row["set_type"],
            }
        )

    for session in sessions:
        session.pop("_by_exercise", None)
    return sessions


def sessions_to_csv(sessions: list[dict]) -> str:
    """Write a history out in the shape this module can read back in.

    Deliberately the Strong column set: it's the simpler of the two, and an
    export you can re-import is the only kind worth having.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["Date", "Workout Name", "Exercise Name", "Set Order", "Weight", "Reps", "Set Type",
         "Seconds", "Notes", "RPE"]
    )
    for session in sessions:
        for exercise in session["exercises"]:
            for i, s in enumerate(exercise["sets"], start=1):
                writer.writerow(
                    [
                        session["started_at"],
                        session["name"] or "",
                        exercise["exercise"],
                        i,
                        "" if s.get("weight") is None else s["weight"],
                        "" if s.get("reps") is None else s["reps"],
                        s.get("set_type") or "working",
                        "" if s.get("duration_seconds") is None else s["duration_seconds"],
                        s.get("notes") or "",
                        "" if s.get("rpe") is None else s["rpe"],
                    ]
                )
    return buffer.getvalue()
