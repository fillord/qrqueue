import enum
import uuid

from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class StaffRole(str, enum.Enum):
    operator = "operator"
    registrar = "registrar"


class StaffCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: StaffRole


class StaffUpdate(BaseModel):
    reset_totp: bool | None = None
    full_name: str | None = None
    password: str | None = None
    role: StaffRole | None = None
    is_active: bool | None = None


class StaffOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    organization_id: uuid.UUID
    is_active: bool
    totp_enabled: bool = False

    model_config = {"from_attributes": True}
