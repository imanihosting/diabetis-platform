"""Service configuration, validated at import time."""

from functools import lru_cache

from pydantic import model_validator
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

    @model_validator(mode="after")
    def require_token_outside_development(self) -> "Settings":
        """Refuses to start unauthenticated anywhere but development.

        This service will answer questions about any user's health data given
        only their id. Leaving auth off is a deliberate local-development
        convenience, and it must never be reachable by forgetting to set a
        variable in a deployed environment.
        """
        if self.environment != "development" and not self.metabolic_engine_token:
            raise ValueError(
                "METABOLIC_ENGINE_TOKEN is required when ENVIRONMENT is "
                f"'{self.environment}'. Service-token auth cannot be disabled "
                "outside development."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
