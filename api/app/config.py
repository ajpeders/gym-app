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

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir.rstrip('/')}/gym.db"

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
