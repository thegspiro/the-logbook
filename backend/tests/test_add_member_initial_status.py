"""
Add Member can set a new member's initial account status (W08-1).

The form offered Status and sent nothing, so a member added "On Leave" was
created active. The owner chose a new optional field on the create endpoint:
active (the default), inactive or leave. Statuses that end or suspend
membership are not starting states — the status change records what they
mean (service history, property return), and a create would skip it.
"""

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError

from app.api.v1.endpoints.users import create_member
from app.models.user import Organization, User, UserStatus
from app.schemas.user import AdminUserCreate

BASE = dict(
    username="newmember",
    email="new@example.org",
    first_name="New",
    last_name="Member",
)


class TestSchema:
    pytestmark = [pytest.mark.unit]

    def test_omitted_means_active(self):
        assert AdminUserCreate(**BASE).status is None

    @pytest.mark.parametrize("value", ["active", "inactive", "leave", " Leave "])
    def test_accepts_the_starting_statuses(self, value):
        assert AdminUserCreate(**BASE, status=value).status == value.strip().lower()

    @pytest.mark.parametrize(
        "value",
        [
            "retired",
            "dropped_voluntary",
            "dropped_involuntary",
            "archived",
            "suspended",
            "nonsense",
        ],
    )
    def test_refuses_a_status_that_ends_or_suspends_membership(self, value):
        with pytest.raises(ValidationError):
            AdminUserCreate(**BASE, status=value)


@pytest.mark.integration
class TestCreate:
    async def _create(self, db_session, **fields):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Initial Status Department",
            slug=f"initstatus-{uuid.uuid4().hex[:8]}",
        )
        db_session.add(org)
        await db_session.flush()
        handle = uuid.uuid4().hex[:8]
        officer = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"officer-{handle}",
            email=f"officer-{handle}@example.org",
            first_name="Olive",
            last_name="Officer",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        db_session.add(officer)
        await db_session.flush()
        data = dict(
            BASE,
            username=f"new-{handle}",
            email=f"new-{handle}@example.org",
            password="Corr3ct-Horse-Battery!",
            send_welcome_email=False,
            **fields,
        )
        created = await create_member(
            user_data=AdminUserCreate(**data),
            background_tasks=BackgroundTasks(),
            request=MagicMock(),
            db=db_session,
            current_user=officer,
        )
        return await db_session.get(User, str(created.id))

    async def test_created_on_leave(self, db_session):
        user = await self._create(db_session, status="leave")
        assert user.status == UserStatus.LEAVE

    async def test_created_active_by_default(self, db_session):
        user = await self._create(db_session)
        assert user.status == UserStatus.ACTIVE
