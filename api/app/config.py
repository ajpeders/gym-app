"""Environment-driven application settings."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-insecure-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GYM_", extra="ignore")

    data_dir: str = "./data"
    jwt_secret: str = DEV_JWT_SECRET
    jwt_expire_hours: int = 720
    jwt_algorithm: str = "HS256"
    cors_origins: str = "*"
    seed_on_start: bool = True

    # --- AI (Phase 3) ---
    # Default provider when a user hasn't chosen one in their settings.
    ai_provider: str = "ollama"
    ollama_url: str = "http://192.168.0.40:11434"
    ollama_model: str = "qwen3:8b"
    claude_api_key: str = ""
    claude_model: str = "claude-opus-4-8"  # configurable; claude-haiku-4-5 is the cheap option
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-luna"
    openai_base_url: str = "https://api.openai.com/v1"
    ai_timeout: float = 120.0  # generous for cold model loads on first request

    # Loopback base URL the companion coach uses to call gym's own API as tools.
    # In the container the app listens on :8000; override via GYM_SELF_BASE_URL.
    self_base_url: str = "http://127.0.0.1:8000"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir.rstrip('/')}/gym.db"

    @property
    def uploads_dir(self) -> str:
        """Where user-uploaded files (progress photos) live. Under data_dir so
        the homelab nightly backup of state/ covers it."""
        return f"{self.data_dir.rstrip('/')}/uploads"

    @property
    def cors_origin_list(self) -> list[str]:
        raw = self.cors_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def jwt_is_default(self) -> bool:
        return self.jwt_secret == DEV_JWT_SECRET


@lru_cache
def get_settings() -> Settings:
    return Settings()
