from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_domain: str = "localhost"
    app_version: str = "dev"

    postgres_db: str = "queue"
    postgres_user: str = "queue"
    postgres_password: str = "queue"
    database_url: str

    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7
    jwt_cookie_name: str = "access_token"
    attendance_secret: str | None = None

    cookie_secure: bool = False

    # Roles that must enroll a TOTP authenticator on first login (ARCHITECTURE.md
    # section 2, users.totp_secret). Other roles use 2FA only if enrolled.
    totp_required_roles: str = "superadmin,org_admin"
    totp_issuer: str = "Online Queue"

    # Redis-backed limits from ARCHITECTURE.md section 6; the disposable-DB
    # test runner turns them off so unrelated tests don't trip them.
    rate_limit_enabled: bool = True
    rate_limit_trial_per_hour: int = 5
    rate_limit_scan_per_minute: int = 10
    rate_limit_login_per_minute: int = 5
    rate_limit_tv_pair_per_minute: int = 5
    rate_limit_assistant_per_minute: int = 10

    qr_token_secret: str
    qr_token_ttl_seconds: int = 45
    qr_selection_ttl_seconds: int = 300
    qr_token_batch_minutes: int = 15

    presence_timeout_minutes: int = 3
    video_base_limit_mb: int = 50
    video_extended_limit_mb: int = 100

    superadmin_email: str
    superadmin_password: str

    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str | None = None

    # Optional cloud answers for the in-product navigator. The navigator's
    # built-in page hints work without these values.
    assistant_ai_enabled: bool = True
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_timeout_seconds: float = 12.0


    @property
    def totp_required_role_set(self) -> frozenset[str]:
        return frozenset(r.strip() for r in self.totp_required_roles.split(",") if r.strip())

    @property
    def attendance_signing_secret(self) -> str:
        return self.attendance_secret or self.jwt_secret


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
