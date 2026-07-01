"""Local Ollama provider (default — free, private, runs in the homelab)."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from .base import AIError


class OllamaProvider:
    name = "ollama"

    # Keep the model resident between requests. Without this Ollama unloads it
    # after ~5 min idle, so every occasional parse pays a cold-load tax on top
    # of generation — the difference between a ~5s and a ~15s+ wait, which is
    # what pushes a mobile request over the edge.
    KEEP_ALIVE = "30m"

    def __init__(self, url: str, model: str, timeout: float = 120.0):
        self.url = url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def complete_json(self, *, system: str, user: str, schema: dict) -> dict:
        body = {
            "model": self.model,
            "stream": False,
            "keep_alive": self.KEEP_ALIVE,
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

    async def stream_json(
        self, *, system: str, user: str, schema: dict
    ) -> AsyncIterator[dict]:
        """Stream a structured-JSON completion.

        Yields ``{"type": "progress", "received": <chars>}`` as tokens arrive
        (keeping the connection alive so a slow generation never looks dead to a
        mobile client), then exactly one ``{"type": "result", "data": <dict>}``.
        Raises AIError on transport failure or unparseable output.
        """
        body = {
            "model": self.model,
            "stream": True,
            "keep_alive": self.KEEP_ALIVE,
            "format": schema,  # Ollama structured outputs
            "options": {"temperature": 0},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        content = ""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST", f"{self.url}/api/chat", json=body
                ) as resp:
                    if resp.status_code >= 400:
                        raise AIError(f"Ollama returned HTTP {resp.status_code}")
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        piece = (chunk.get("message") or {}).get("content", "")
                        if piece:
                            content += piece
                            yield {"type": "progress", "received": len(content)}
                        if chunk.get("done"):
                            break
        except httpx.HTTPError as exc:
            raise AIError(f"Ollama request failed: {exc!r}") from exc

        if not content:
            raise AIError("Ollama returned empty content")
        try:
            data = json.loads(content)
        except json.JSONDecodeError as exc:
            raise AIError(f"Ollama returned unparseable JSON: {exc}") from exc
        yield {"type": "result", "data": data}

    async def complete_text(self, *, system: str, messages: list[dict]) -> str:
        body = {
            "model": self.model,
            "stream": False,
            "keep_alive": self.KEEP_ALIVE,
            "options": {"temperature": 0.5},
            "messages": [{"role": "system", "content": system}, *messages],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.url}/api/chat", json=body)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            raise AIError(f"Ollama request failed: {exc!r}") from exc
        content = (data.get("message") or {}).get("content", "").strip()
        if not content:
            raise AIError("Ollama returned empty content")
        return content
