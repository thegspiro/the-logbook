"""Everyday endpoint surfaces name a member by the name they go by.

John Terry Heather goes by "Terry": a role's member list, the operator roster,
the notification log and the MCP roster say "Terry Heather", while the legal
``full_name`` those payloads already carried keeps meaning the name of record.

DB-free: the endpoints are called with mocked services and the schemas are
built from transient ``User`` rows.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints.roles import get_role_users
from app.models.notification import NotificationLog
from app.models.user import User, UserStatus
from app.schemas.apparatus import ApparatusOperatorResponse
from app.schemas.role import UserRoleResponse

pytestmark = [pytest.mark.unit]

ORG = str(uuid.uuid4())


def _terry(**overrides) -> User:
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=ORG,
        username="theather",
        email="theather@example.com",
        first_name="John",
        last_name="Heather",
        preferred_name="Terry",
        status=UserStatus.ACTIVE,
    )
    fields.update(overrides)
    return User(**fields)


class TestRoleUsers:
    async def test_display_name_is_added_and_full_name_stays_legal(self):
        role = SimpleNamespace(id=str(uuid.uuid4()), name="Lieutenant")
        terry = _terry()
        with patch("app.api.v1.endpoints.roles.role_service") as service:
            service.get_role = AsyncMock(return_value=role)
            service.get_users_with_role = AsyncMock(return_value=[terry])

            response = await get_role_users(
                role_id=uuid.UUID(role.id),
                db=AsyncMock(),
                current_user=SimpleNamespace(organization_id=ORG),
            )

        item = response.users[0]
        assert item.full_name == "John Heather"
        assert item.display_name == "Terry Heather"
        assert item.preferred_name == "Terry"

    async def test_without_a_preferred_name_both_read_the_same(self):
        role = SimpleNamespace(id=str(uuid.uuid4()), name="Lieutenant")
        with patch("app.api.v1.endpoints.roles.role_service") as service:
            service.get_role = AsyncMock(return_value=role)
            service.get_users_with_role = AsyncMock(
                return_value=[_terry(preferred_name=None)]
            )

            response = await get_role_users(
                role_id=uuid.UUID(role.id),
                db=AsyncMock(),
                current_user=SimpleNamespace(organization_id=ORG),
            )

        item = response.users[0]
        assert item.full_name == item.display_name == "John Heather"

    def test_user_role_response_carries_display_name(self):
        terry = _terry()
        body = UserRoleResponse(
            user_id=terry.id,
            username=terry.username,
            full_name=terry.full_name,
            display_name=terry.display_name,
            roles=[],
        )
        assert body.full_name == "John Heather"
        assert body.display_name == "Terry Heather"


class TestOperatorRoster:
    def test_operator_is_named_by_preferred_name(self):
        now = datetime.now(timezone.utc)
        body = ApparatusOperatorResponse.model_validate(
            {
                "id": str(uuid.uuid4()),
                "organization_id": ORG,
                "apparatus_id": str(uuid.uuid4()),
                "user_id": str(uuid.uuid4()),
                "created_at": now,
                "updated_at": now,
                "user": _terry(),
            }
        )
        assert body.user_name == "Terry Heather"


class TestNotificationLog:
    def test_recipient_is_named_by_preferred_name(self):
        log = NotificationLog(recipient=_terry())
        assert log.recipient_name == "Terry Heather"

    def test_falls_back_to_the_first_name(self):
        log = NotificationLog(recipient=_terry(preferred_name=None))
        assert log.recipient_name == "John Heather"

    def test_no_recipient_has_no_name(self):
        assert NotificationLog().recipient_name is None
