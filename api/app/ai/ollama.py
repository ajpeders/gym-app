"""Local Ollama provider (default — free, private, runs in the homelab)."""
from __future__ import annotations

import httpx

from .base import PARSE_SCHEMA, AIError, ParsedWorkout
from .prompts import system_prompt, user_prompt


class OllamaProvider:
    name = "ollama"

    def __init__(self, url: str, model: str, timeout: float = 60.0):
        self.url = url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def parse(self, *, text: str, units: str, hint_names: list[str]) -> ParsedWorkout:
        body = {
            "model": self.model,
            "stream": False,
            "format": PARSE_SCHEMA,  # Ollama structured outputs
            "options": {"temperature": 0},
            "messages": [
                {"role": "system", "content": system_prompt(units)},
                {"role": "user", "content": user_prompt(text, hint_names)},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.url}/api/chat", json=body)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            raise AIError(f"Ollama request failed: {exc}") from exc

        content = (data.get("message") or {}).get("content", "")
        if not content:
            raise AIError("Ollama returned empty content")
        try:
            return ParsedWorkout.model_validate_json(content)
        except Exception as exc:  # noqa: BLE001
            raise AIError(f"Ollama returned unparseable JSON: {exc}") from exc
