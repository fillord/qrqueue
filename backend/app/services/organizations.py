from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import AuditActorType
from app.models.organization import Organization
from app.models.queue import Queue
from app.models.ticket import Ticket
from app.models.enums import TicketStatus
from app.clock import utcnow
from app.models.user import User
from app.schemas.organization import OrganizationCreate, OrganizationSelfUpdate, OrganizationUpdate
from app.services.audit import log_action
from app.services.realtime import defer_event, organization_channel, queue_channel
from app.services.slug import generate_unique_slug


async def list_organizations(db: AsyncSession) -> list[Organization]:
    result = await db.execute(select(Organization).where(Organization.deleted_at.is_(None)).order_by(Organization.name))
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

    if "is_active" in changes:
        await db.execute(update(User).where(User.organization_id == org.id).values(auth_version=User.auth_version + 1))

    if changes:
        defer_event(db, organization_channel(org.id), "organization.updated")
        queue_ids = (await db.execute(select(Queue.id).where(Queue.organization_id == org.id))).scalars().all()
        for queue_id in queue_ids:
            defer_event(db, queue_channel(queue_id), "organization.updated")

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


async def archive_organization(db: AsyncSession, org: Organization, actor: User) -> None:
    active = await db.scalar(select(Ticket.id).where(
        Ticket.organization_id == org.id,
        Ticket.status.in_([TicketStatus.waiting, TicketStatus.called, TicketStatus.confirmed, TicketStatus.serving]),
    ).limit(1))
    if active is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "active_tickets"})
    org.deleted_at = utcnow()
    org.is_active = False
    await db.flush()
    await db.execute(update(User).where(User.organization_id == org.id).values(auth_version=User.auth_version + 1))
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
                     action="organization.archived", entity_type="organization", entity_id=org.id,
                     organization_id=org.id, payload={"name": org.name, "slug": org.slug})
    defer_event(db, organization_channel(org.id), "organization.updated")
    queue_ids = (await db.execute(select(Queue.id).where(Queue.organization_id == org.id))).scalars().all()
    for queue_id in queue_ids:
        defer_event(db, queue_channel(queue_id), "organization.updated")


async def restore_organization(db: AsyncSession, org: Organization, actor: User) -> Organization:
    org.deleted_at = None
    org.is_active = False  # Restoration never reopens public queues automatically.
    await db.flush()
    await log_action(db, actor_type=AuditActorType.user, actor_id=actor.id,
                     action="organization.restored", entity_type="organization", entity_id=org.id,
                     organization_id=org.id)
    return org
