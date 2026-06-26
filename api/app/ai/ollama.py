"""Local Ollama provider (default — free, private, runs in the homelab)."""
from __future__ import annotations

import json

import httpx

from .base import AIError


class OllamaProvider:
    name = "ollama"

    def __init__(self, url: str, model: str, timeout: float = 120.0):
        self.url = url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def complete_json(self, *, system: str, user: str, schema: dict) -> dict:
        body = {
            "model": self.model,
            "stream": False,
            "format": schema,  # Ollama structured outputs
            "options": {"temperature": 0},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.url}/api/chat", json=body)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            raise AIError(f"Ollama request failed: {exc!r}") from exc

        content = (data.get("message") or {}).get("content", "")
        if not content:
            raise AIError("Ollama returned empty content")
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise AIError(f"Ollama returned unparseable JSON: {exc}") from exc
