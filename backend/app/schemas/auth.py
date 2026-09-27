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
    has_photo: bool = False
    photo_revision: int = 0

    model_config = {"from_attributes": True}


class ProfileNameUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)


class ProfilePasswordUpdate(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ProfileEmailUpdate(BaseModel):
    current_password: str
    email: EmailStr
