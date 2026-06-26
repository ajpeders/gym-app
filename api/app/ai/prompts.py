"""Prompts for natural-language workout parsing."""
from __future__ import annotations

# Only this part runs through str.format(units=...); keep literal braces out of it.
_RULES = (
    "You extract structured strength-training data from a user's natural-language "
    "workout log. Return JSON matching the schema: a list of exercises, each with its sets.\n"
    "Rules:\n"
    "- Weights are in {units}. Output the numeric value as stated; never convert units.\n"
    "- '3x8' means 3 sets of 8 reps. '5x5 @100' means 5 sets of 5 reps at 100 {units}.\n"
    "- '@60', 'at 60', '60kg', '135lb' is the weight. 'RPE 8' or '@8' is the rpe.\n"
    "- Bodyweight or an unspecified weight means weight = null.\n"
    "- 'warmup' sets -> set_type warmup; 'dropset'/'drop' -> drop; 'to failure'/'AMRAP' -> failure; "
    "otherwise working.\n"
    "- Expand 'N sets of M reps' into N set objects (repeat reps/weight) unless the user gives per-set values.\n"
    "- Put subjective comments ('felt easy', 'left shoulder tweaked') into notes. Never invent numbers.\n"
    "- Use the exact exercise name the user said, kept concise (e.g. 'Barbell Bench Press')."
)

# Literal JSON example — never passed through .format() (its braces would break it).
_EXAMPLE = (
    "Example input: 'incline press 3x8 @50, then 2x12 lateral raises 10'\n"
    "Example output: "
    '{"exercises":['
    '{"exercise":"Incline Press","sets":['
    '{"reps":8,"weight":50,"rpe":null,"set_type":"working"},'
    '{"reps":8,"weight":50,"rpe":null,"set_type":"working"},'
    '{"reps":8,"weight":50,"rpe":null,"set_type":"working"}],"notes":null},'
    '{"exercise":"Lateral Raises","sets":['
    '{"reps":12,"weight":10,"rpe":null,"set_type":"working"},'
    '{"reps":12,"weight":10,"rpe":null,"set_type":"working"}],"notes":null}]}'
)


def system_prompt(units: str) -> str:
    return _RULES.format(units=units) + "\n\n" + _EXAMPLE


def user_prompt(text: str, hint_names: list[str]) -> str:
    hint = ""
    if hint_names:
        hint = (
            "\n\nExercises already in this session (prefer these names when the user "
            "clearly means them): " + ", ".join(hint_names)
        )
    return f"Workout log:\n{text}{hint}"
