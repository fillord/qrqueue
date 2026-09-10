from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_domain: str = "localhost"

    postgres_db: str = "queue"
    postgres_user: str = "queue"
    postgres_password: str = "queue"
    database_url: str

    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7
    jwt_cookie_name: str = "access_token"

    qr_token_secret: str
    qr_token_ttl_seconds: int = 45
    qr_token_batch_minutes: int = 15

    presence_timeout_minutes: int = 3

    superadmin_email: str
    superadmin_password: str

    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
