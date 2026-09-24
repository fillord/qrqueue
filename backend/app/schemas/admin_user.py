from datetime import datetime

from app.schemas.validation import Name, Password, PatchModel
import uuid

from pydantic import BaseModel, EmailStr

from app.models.enums import UserRole
from typing import Literal


class AdminCreate(BaseModel):
    email: EmailStr
    password: Password
    full_name: Name


class AdminUpdate(PatchModel):
    email: EmailStr | None = None
    full_name: Name | None = None
    password: Password | None = None
    is_active: bool | None = None
    reset_totp: bool | None = None


class UserCreate(BaseModel):
    email: EmailStr
    password: Password
    full_name: Name
    role: Literal[UserRole.org_admin, UserRole.operator, UserRole.registrar]
    organization_id: uuid.UUID


class UserUpdate(PatchModel):
    email: EmailStr | None = None
    full_name: Name | None = None
    password: Password | None = None
    role: Literal[UserRole.org_admin, UserRole.operator, UserRole.registrar] | None = None
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
    deleted_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserDirectoryOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: UserRole
    organization_id: uuid.UUID | None
    organization_name: str | None
    is_active: bool
    totp_enabled: bool
    deleted_at: datetime | None = None
