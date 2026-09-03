"""
`GET /events/{id}/eligible-members` is a member-facing list: `events.manage`
reaches several operational positions, so the email column answers to the
same contact policy as the directory rather than being handed out raw.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.events import get_eligible_members
from app.utils.contact_visibility import ContactPolicy

pytestmark = [pytest.mark.unit]

ORG = str(uuid.uuid4())


def _caller(*permissions: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        organization_id=ORG,
        positions=[SimpleNamespace(permissions=list(permissions))],
        rank=None,
    )


def _member(profile_visibility=None) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        first_name="Jordan",
        last_name="Smith",
        email="jsmith@example.com",
        profile_visibility=profile_visibility,
    )


def _db(event, members) -> MagicMock:
    event_result = MagicMock()
    event_result.scalar_one_or_none = MagicMock(return_value=event)
    members_result = MagicMock()
    members_result.scalars = MagicMock(
        return_value=SimpleNamespace(all=lambda: members)
    )
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[event_result, members_result])
    return db


ALL_ON = ContactPolicy(
    show_email=True, show_phone=True, show_mobile=True, honor_member_choice=True
)


class TestEligibleMembersEmail:
    async def test_check_in_staff_do_not_see_an_email_the_member_hid(self):
        member = _member({"email": False})
        with patch(
            "app.api.v1.endpoints.events.load_contact_policy",
            new=AsyncMock(return_value=ALL_ON),
        ) as load:
            rows = await get_eligible_members(
                event_id=uuid.uuid4(),
                db=_db(SimpleNamespace(id="e1"), [member]),
                current_user=_caller("events.manage"),
            )

        assert rows[0]["email"] is None
        assert rows[0]["last_name"] == "Smith"
        assert load.await_args.kwargs["is_manager"] is False

    async def test_email_shown_where_the_policy_allows(self):
        member = _member(None)
        with patch(
            "app.api.v1.endpoints.events.load_contact_policy",
            new=AsyncMock(return_value=ALL_ON),
        ):
            rows = await get_eligible_members(
                event_id=uuid.uuid4(),
                db=_db(SimpleNamespace(id="e1"), [member]),
                current_user=_caller("events.manage"),
            )

        assert rows[0]["email"] == "jsmith@example.com"

    async def test_members_manager_is_marked_as_such(self):
        with patch(
            "app.api.v1.endpoints.events.load_contact_policy",
            new=AsyncMock(return_value=ALL_ON),
        ) as load:
            await get_eligible_members(
                event_id=uuid.uuid4(),
                db=_db(SimpleNamespace(id="e1"), []),
                current_user=_caller("events.manage", "members.manage"),
            )

        assert load.await_args.kwargs["is_manager"] is True
