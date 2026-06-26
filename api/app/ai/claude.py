"""Frontier provider via the official Anthropic SDK (toggle — best quality)."""
from __future__ import annotations

import json

from .base import AIError


class ClaudeProvider:
    name = "claude"

    def __init__(self, api_key: str, model: str, timeout: float = 120.0):
        if not api_key:
            raise AIError("Claude is not configured (set GYM_CLAUDE_API_KEY).")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    async def complete_json(self, *, system: str, user: str, schema: dict) -> dict:
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:  # pragma: no cover
            raise AIError("anthropic SDK not installed") from exc

        try:
            async with AsyncAnthropic(api_key=self.api_key, timeout=self.timeout) as client:
                resp = await client.messages.create(
                    model=self.model,
                    max_tokens=4000,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                )
        except Exception as exc:  # noqa: BLE001 - surface any SDK/API error uniformly
            raise AIError(f"Claude request failed: {exc!r}") from exc

        raw = "".join(
            getattr(b, "text", "") for b in resp.content if getattr(b, "type", None) == "text"
        ).strip()
        if not raw:
            raise AIError("Claude returned no text content")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise AIError(f"Claude returned unparseable JSON: {exc}") from exc
