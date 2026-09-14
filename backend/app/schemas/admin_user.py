import uuid

from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class AdminCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class AdminUpdate(BaseModel):
    is_active: bool | None = None
    reset_totp: bool | None = None


class AdminOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    organization_id: uuid.UUID
    is_active: bool
    totp_enabled: bool = False

    model_config = {"from_attributes": True}
