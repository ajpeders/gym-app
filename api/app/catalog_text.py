"""Reading the catalog's text the way a person would.

The exercise sources ship their quirks: a marketing paragraph before the
steps, a literal "Notes (Instructions):" line, "Starting position:" and
"Steps:" headings that render as numbered steps of their own, zero-width
spaces at the start of lines. The rows are left as they came — the seed is
re-runnable and the data is CC-BY-SA — and the cleaning happens where the
list is served, so every screen sees the same steps.
"""
from __future__ import annotations

import re

_INVISIBLE = re.compile(r"[\u200b\u200c\u200d\ufeff]")
# A short line ending in a colon is a heading, not a step.
_HEADING = re.compile(r"^[A-Za-z ()/]{1,40}:$")
_NOTES_INSTRUCTIONS = re.compile(r"^notes\s*\(instructions\)\s*:?$", re.I)


def clean_instructions(steps: list[str] | None) -> list[str]:
    cleaned = [_INVISIBLE.sub("", s).strip() for s in (steps or [])]
    cleaned = [s for s in cleaned if s]

    # "Notes (Instructions):" marks where the real steps begin. Everything
    # before it is a description of the exercise, not how to do it.
    for i, s in enumerate(cleaned):
        if _NOTES_INSTRUCTIONS.match(s):
            cleaned = cleaned[i + 1 :]
            break
    else:
        # No marker: a long first paragraph followed by short lines is the
        # same preamble without the label.
        if len(cleaned) > 2 and len(cleaned[0]) > 200 and all(len(s) < 200 for s in cleaned[1:]):
            cleaned = cleaned[1:]

    out: list[str] = []
    for s in cleaned:
        if _HEADING.match(s):
            continue
        out.append(s)
    return out
