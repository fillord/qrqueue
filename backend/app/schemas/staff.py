from datetime import datetime

from app.schemas.validation import Name, Password, PatchModel
import enum
import uuid

from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole


class StaffRole(str, enum.Enum):
    operator = "operator"
    registrar = "registrar"


class StaffCreate(BaseModel):
    email: EmailStr
    password: Password
    full_name: Name
    role: StaffRole


class StaffUpdate(PatchModel):
    reset_totp: bool | None = None
    email: EmailStr | None = None
    full_name: Name | None = None
    password: Password | None = None
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
    deleted_at: datetime | None = None

    model_config = {"from_attributes": True}
