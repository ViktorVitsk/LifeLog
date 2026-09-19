from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    database_url: str = Field(
        default="postgresql+asyncpg://lifelog:lifelog@postgres:5432/lifelog",
        alias="DATABASE_URL",
    )

    jwt_secret: str = Field(default="change-me", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(default=10080, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    login_max_failures: int = Field(default=5, ge=1, alias="LOGIN_MAX_FAILURES")
    login_failure_window_seconds: int = Field(
        default=300,
        ge=1,
        alias="LOGIN_FAILURE_WINDOW_SECONDS",
    )

    pbkdf2_iterations: int = Field(default=100_000, alias="PBKDF2_ITERATIONS")

    cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        alias="CORS_ORIGINS",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
