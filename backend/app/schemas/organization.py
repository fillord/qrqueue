import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel
from app.schemas.validation import Name, Timezone, Color, PatchModel

from app.models.enums import Language, Plan


class OrganizationCreate(BaseModel):
    name: Name
    slug: str | None = None
    template: Literal["blank", "clinic", "service_center"] = "blank"
    timezone: Timezone = "Asia/Almaty"
    default_language: Language = Language.ru
    logo_url: str | None = None
    brand_color: Color | None = None
    plan: Plan = Plan.trial
    trial_ends_at: datetime | None = None
    one_ticket_per_org: bool = False


class OrganizationUpdate(PatchModel):
    nullable_fields = frozenset({"logo_url", "brand_color", "trial_ends_at"})
    name: Name | None = None
    slug: str | None = None
    timezone: Timezone | None = None
    default_language: Language | None = None
    logo_url: str | None = None
    brand_color: Color | None = None
    plan: Plan | None = None
    trial_ends_at: datetime | None = None
    one_ticket_per_org: bool | None = None
    is_active: bool | None = None
    video_large_upload_enabled: bool | None = None


class OrganizationSelfUpdate(PatchModel):
    nullable_fields = frozenset({"logo_url", "brand_color"})
    """Fields an org_admin may change about their own organization."""

    model_config = {"extra": "forbid"}

    name: Name | None = None
    logo_url: str | None = None
    brand_color: Color | None = None
    default_language: Language | None = None
    timezone: Timezone | None = None
    one_ticket_per_org: bool | None = None


class OrganizationOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    timezone: str
    default_language: Language
    logo_url: str | None
    brand_color: str | None
    plan: Plan
    trial_ends_at: datetime | None
    one_ticket_per_org: bool
    is_active: bool
    deleted_at: datetime | None = None
    video_large_upload_enabled: bool

    model_config = {"from_attributes": True}
