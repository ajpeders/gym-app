"""Frontier provider via the official Anthropic SDK (toggle — best quality)."""
from __future__ import annotations

import json

from .base import PARSE_SCHEMA, AIError, ParsedWorkout
from .prompts import system_prompt, user_prompt


class ClaudeProvider:
    name = "claude"

    def __init__(self, api_key: str, model: str, timeout: float = 60.0):
        if not api_key:
            raise AIError("Claude is not configured (set GYM_CLAUDE_API_KEY).")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    async def parse(self, *, text: str, units: str, hint_names: list[str]) -> ParsedWorkout:
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:  # pragma: no cover
            raise AIError("anthropic SDK not installed") from exc

        try:
            async with AsyncAnthropic(api_key=self.api_key, timeout=self.timeout) as client:
                resp = await client.messages.create(
                    model=self.model,
                    max_tokens=1500,
                    system=system_prompt(units),
                    messages=[{"role": "user", "content": user_prompt(text, hint_names)}],
                    output_config={
                        "format": {"type": "json_schema", "schema": PARSE_SCHEMA}
                    },
                )
        except Exception as exc:  # noqa: BLE001 - surface any SDK/API error uniformly
            raise AIError(f"Claude request failed: {exc}") from exc

        raw = "".join(
            getattr(b, "text", "") for b in resp.content if getattr(b, "type", None) == "text"
        ).strip()
        if not raw:
            raise AIError("Claude returned no text content")
        try:
            return ParsedWorkout.model_validate(json.loads(raw))
        except Exception as exc:  # noqa: BLE001
            raise AIError(f"Claude returned unparseable JSON: {exc}") from exc
