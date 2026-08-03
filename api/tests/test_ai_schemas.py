"""Guard the AI structured-output schemas against self-contradiction.

Every object node uses ``additionalProperties: false`` + full ``required``
lists (both Ollama's ``format`` and Claude's strict structured outputs need
that). A key listed in ``required`` but missing from ``properties`` makes the
schema unsatisfiable: the model must emit the key, yet emitting it violates
``additionalProperties: false``.
"""
from __future__ import annotations

import pytest

from app.ai.base import (
    CHECKIN_SCHEMA,
    EDIT_SPLIT_SCHEMA,
    EDIT_WORKOUT_SCHEMA,
    NUTRITION_SCHEMA,
    PARSE_DAYS_SCHEMA,
    PARSE_SCHEMA,
    PROGRAM_SCHEMA,
)


def _object_nodes(node, path="$"):
    """Yield (path, node) for every object-typed schema node."""
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield path, node
        for key, child in node.items():
            yield from _object_nodes(child, f"{path}.{key}")
    elif isinstance(node, list):
        for i, child in enumerate(node):
            yield from _object_nodes(child, f"{path}[{i}]")


@pytest.mark.parametrize(
    "schema",
    [
        PARSE_SCHEMA,
        PARSE_DAYS_SCHEMA,
        PROGRAM_SCHEMA,
        EDIT_WORKOUT_SCHEMA,
        EDIT_SPLIT_SCHEMA,
        CHECKIN_SCHEMA,
        NUTRITION_SCHEMA,
    ],
    ids=["parse", "parse_days", "program", "edit_workout", "edit_split", "checkin", "nutrition"],
)
def test_required_keys_are_declared_properties(schema):
    for path, node in _object_nodes(schema):
        required = set(node.get("required", []))
        declared = set(node.get("properties", {}))
        missing = required - declared
        assert not missing, f"{path}: required keys missing from properties: {sorted(missing)}"


def test_program_schema_carries_program_level_fields():
    """The import flow surfaces program name/notes/rules — the schema must let
    the model emit them (they exist on ParsedProgram and in the UI)."""
    props = PROGRAM_SCHEMA["properties"]
    assert "name" in props
    assert "notes" in props
    assert "rules" in props
    assert props["rules"]["type"] == "array"
