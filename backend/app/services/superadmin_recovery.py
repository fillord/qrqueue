"""Server-console recovery for the configured superadmin account."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.enums import AuditActorType, UserRole
from app.models.user import User
from app.security import verify_password
from app.services.audit import log_action


class RecoveryDenied(Exception):
    pass


async def recover_superadmin_totp(db: AsyncSession, email: str, password: str) -> None:
    if email.lower() != settings.superadmin_email.lower():
        raise RecoveryDenied("This is not the configured superadmin account")

    result = await db.execute(select(User).where(User.email == email.lower()).with_for_update())
    user = result.scalar_one_or_none()
    if (user is None or user.role != UserRole.superadmin or not user.is_active
            or not verify_password(password, user.password_hash)):
        raise RecoveryDenied("Account or password is incorrect")
    if user.totp_secret is None:
        raise RecoveryDenied("Two-factor authentication is not enrolled")

    user.totp_secret = None
    user.auth_version += 1
    await log_action(
        db, actor_type=AuditActorType.user, actor_id=user.id,
        action="user.totp_recovered", entity_type="user", entity_id=user.id,
        payload={"method": "server_console"},
    )
    await db.commit()
