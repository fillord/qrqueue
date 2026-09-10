from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationCreate, OrganizationSelfUpdate, OrganizationUpdate
from app.services.audit import log_action
from app.services.slug import generate_unique_slug


async def list_organizations(db: AsyncSession) -> list[Organization]:
    result = await db.execute(select(Organization).order_by(Organization.name))
    return list(result.scalars().all())


async def create_organization(
    db: AsyncSession, payload: OrganizationCreate, actor: User
) -> Organization:
    slug = payload.slug or await generate_unique_slug(db, payload.name)

    org = Organization(
        name=payload.name,
        slug=slug,
        timezone=payload.timezone,
        default_language=payload.default_language,
        logo_url=payload.logo_url,
        brand_color=payload.brand_color,
        plan=payload.plan,
        trial_ends_at=payload.trial_ends_at,
        one_ticket_per_org=payload.one_ticket_per_org,
    )
    db.add(org)
    await db.flush()

    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action="organization.created",
        entity_type="organization",
        entity_id=org.id,
        organization_id=org.id,
        payload=jsonable_encoder(payload.model_dump(exclude_unset=True) | {"slug": slug}),
    )
    return org


async def update_organization(
    db: AsyncSession,
    org: Organization,
    payload: OrganizationUpdate | OrganizationSelfUpdate,
    actor: User,
) -> Organization:
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(org, field, value)
    await db.flush()

    action = "organization.deactivated" if changes.get("is_active") is False else "organization.updated"
    await log_action(
        db,
        actor_type=AuditActorType.user,
        actor_id=actor.id,
        action=action,
        entity_type="organization",
        entity_id=org.id,
        organization_id=org.id,
        payload=jsonable_encoder(changes),
    )
    return org
