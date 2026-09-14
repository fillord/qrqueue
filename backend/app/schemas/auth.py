import uuid

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import UserRole


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TotpSetupOut(BaseModel):
    """Sent only during enrollment: the secret is not persisted until the
    user proves their authenticator with a valid code."""

    secret: str
    otpauth_uri: str


class LoginResponse(BaseModel):
    totp_required: bool = False
    totp_setup: TotpSetupOut | None = None


class TotpRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    organization_id: uuid.UUID | None
    totp_enabled: bool = False

    model_config = {"from_attributes": True}
