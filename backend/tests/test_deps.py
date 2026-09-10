import pytest
from fastapi import HTTPException

from app.api.deps import require_role
from app.models.enums import UserRole
from app.models.user import User


def _user(role: UserRole) -> User:
    return User(
        email="x@example.com",
        password_hash="hash",
        full_name="X",
        role=role,
        organization_id=None,
        is_active=True,
    )


async def test_require_role_allows_matching_role():
    dependency = require_role("org_admin")
    user = _user(UserRole.org_admin)

    result = await dependency(user=user)

    assert result is user


async def test_require_role_denies_other_role():
    dependency = require_role("org_admin")
    user = _user(UserRole.operator)

    with pytest.raises(HTTPException) as exc_info:
        await dependency(user=user)

    assert exc_info.value.status_code == 403
