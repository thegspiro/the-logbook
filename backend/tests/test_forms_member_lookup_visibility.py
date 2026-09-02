"""
`GET /forms/member-lookup` discloses a member's email on the same terms as the
directory: the organisation's contact-visibility ceiling and the member's own
profile-visibility choice, with members-managers exempt from the latter.

Any signed-in member can call the lookup (the field appears inside prospect
applications and event requests), so before this policy it was a way round
both the ceiling and the choice.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.forms import member_lookup
from app.schemas.organization import ContactInfoSettings
from app.services.forms_service import FormsService
from app.utils.contact_visibility import (
    HIDE_ALL,
    ContactPolicy,
    load_contact_policy,
)

pytestmark = [pytest.mark.unit]

ORG = str(uuid.uuid4())


def _member(profile_visibility=None) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        first_name="Jordan",
        last_name="Smith",
        membership_number="1200",
        rank="firefighter",
        station="6",
        email="jsmith@example.com",
        phone="555-0100",
        mobile="555-0199",
        profile_visibility=profile_visibility,
    )


ALL_ON = ContactPolicy(
    show_email=True, show_phone=True, show_mobile=True, honor_member_choice=True
)
MANAGER = ContactPolicy(
    show_email=True, show_phone=True, show_mobile=True, honor_member_choice=False
)


class TestContactPolicy:
    def test_default_choice_shows_work_fields_where_the_org_allows(self):
        member = _member(None)
        assert ALL_ON.email_for(member) == "jsmith@example.com"
        assert ALL_ON.phone_for(member) == "555-0100"
        assert ALL_ON.mobile_for(member) == "555-0199"

    def test_member_choice_hides_within_the_ceiling(self):
        member = _member({"email": False, "phone": True, "mobile": False})
        assert ALL_ON.email_for(member) is None
        assert ALL_ON.phone_for(member) == "555-0100"
        assert ALL_ON.mobile_for(member) is None

    def test_org_ceiling_wins_over_a_member_who_shares(self):
        member = _member({"email": True, "phone": True, "mobile": True})
        assert HIDE_ALL.email_for(member) is None
        assert HIDE_ALL.phone_for(member) is None

    def test_manager_is_exempt_from_the_choice_but_not_the_ceiling(self):
        member = _member({"email": False, "phone": False, "mobile": False})
        assert MANAGER.email_for(member) == "jsmith@example.com"
        ceiling = ContactPolicy(
            show_email=False,
            show_phone=True,
            show_mobile=True,
            honor_member_choice=False,
        )
        assert ceiling.email_for(member) is None
        assert ceiling.phone_for(member) == "555-0100"


class TestLoadContactPolicy:
    @staticmethod
    def _settings(enabled: bool, **flags) -> SimpleNamespace:
        return SimpleNamespace(
            contact_info_visibility=ContactInfoSettings(enabled=enabled, **flags)
        )

    async def test_reads_the_org_ceiling(self):
        service = MagicMock()
        service.get_organization_settings = AsyncMock(
            return_value=self._settings(True, show_email=True, show_phone=False)
        )
        with patch(
            "app.services.organization_service.OrganizationService",
            return_value=service,
        ):
            policy = await load_contact_policy(MagicMock(), ORG, is_manager=False)

        assert policy == ContactPolicy(
            show_email=True,
            show_phone=False,
            show_mobile=True,
            honor_member_choice=True,
        )

    async def test_org_switch_off_hides_everything(self):
        service = MagicMock()
        service.get_organization_settings = AsyncMock(
            return_value=self._settings(False)
        )
        with patch(
            "app.services.organization_service.OrganizationService",
            return_value=service,
        ):
            policy = await load_contact_policy(MagicMock(), ORG, is_manager=True)

        assert policy.show_email is False
        assert policy.show_phone is False
        assert policy.honor_member_choice is False

    async def test_fails_closed_when_settings_cannot_be_read(self):
        service = MagicMock()
        service.get_organization_settings = AsyncMock(side_effect=RuntimeError("db"))
        with patch(
            "app.services.organization_service.OrganizationService",
            return_value=service,
        ):
            policy = await load_contact_policy(MagicMock(), ORG, is_manager=True)

        assert policy == HIDE_ALL


class _ScalarsResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class TestSearchMembers:
    @staticmethod
    def _service(member) -> FormsService:
        db = MagicMock()
        db.execute = AsyncMock(return_value=_ScalarsResult([member]))
        return FormsService(db)

    async def test_withholds_email_the_member_hid(self):
        member = _member({"email": False})
        rows = await self._service(member).search_members(
            uuid.UUID(ORG), "smith", contact_policy=ALL_ON
        )

        assert rows[0]["email"] is None
        # The member is still found; only the disclosure is withheld.
        assert rows[0]["full_name"] == "Jordan Smith"

    async def test_shows_email_the_policy_allows(self):
        member = _member(None)
        rows = await self._service(member).search_members(
            uuid.UUID(ORG), "smith", contact_policy=ALL_ON
        )

        assert rows[0]["email"] == "jsmith@example.com"

    async def test_no_policy_means_no_email(self):
        rows = await self._service(_member(None)).search_members(
            uuid.UUID(ORG), "smith"
        )

        assert rows[0]["email"] is None


class TestEndpoint:
    async def test_passes_the_callers_policy_to_the_search(self):
        caller = SimpleNamespace(
            id=str(uuid.uuid4()),
            organization_id=ORG,
            positions=[SimpleNamespace(permissions=["members.view"])],
            rank=None,
        )
        with (
            patch(
                "app.api.v1.endpoints.forms.load_contact_policy",
                new=AsyncMock(return_value=ALL_ON),
            ) as load,
            patch.object(
                FormsService, "search_members", new=AsyncMock(return_value=[])
            ) as search,
        ):
            await member_lookup(
                q="smith", limit=20, db=MagicMock(), current_user=caller
            )

        load.assert_awaited_once()
        assert load.await_args.kwargs["is_manager"] is False
        assert search.await_args.kwargs["contact_policy"] is ALL_ON

    async def test_members_manager_is_marked_as_such(self):
        caller = SimpleNamespace(
            id=str(uuid.uuid4()),
            organization_id=ORG,
            positions=[SimpleNamespace(permissions=["members.manage"])],
            rank=None,
        )
        with (
            patch(
                "app.api.v1.endpoints.forms.load_contact_policy",
                new=AsyncMock(return_value=MANAGER),
            ) as load,
            patch.object(
                FormsService, "search_members", new=AsyncMock(return_value=[])
            ),
        ):
            await member_lookup(
                q="smith", limit=20, db=MagicMock(), current_user=caller
            )

        assert load.await_args.kwargs["is_manager"] is True
