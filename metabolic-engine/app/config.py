"""Service configuration, validated at import time."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    """Same PostgreSQL instance the API uses. The engine reads; it does not own schema."""

    metabolic_engine_token: str | None = None
    """Shared secret the NestJS backend presents. When unset, auth is disabled (dev only)."""

    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
