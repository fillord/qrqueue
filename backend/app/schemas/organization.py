import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import Language, Plan


class OrganizationCreate(BaseModel):
    name: str
    slug: str | None = None
    timezone: str = "Asia/Almaty"
    default_language: Language = Language.ru
    logo_url: str | None = None
    brand_color: str | None = None
    plan: Plan = Plan.trial
    trial_ends_at: datetime | None = None
    one_ticket_per_org: bool = False


class OrganizationUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    timezone: str | None = None
    default_language: Language | None = None
    logo_url: str | None = None
    brand_color: str | None = None
    plan: Plan | None = None
    trial_ends_at: datetime | None = None
    one_ticket_per_org: bool | None = None
    is_active: bool | None = None


class OrganizationSelfUpdate(BaseModel):
    """Fields an org_admin may change about their own organization."""

    model_config = {"extra": "forbid"}

    name: str | None = None
    logo_url: str | None = None
    brand_color: str | None = None
    default_language: Language | None = None
    timezone: str | None = None
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

    model_config = {"from_attributes": True}
