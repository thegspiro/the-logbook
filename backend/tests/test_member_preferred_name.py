"""A member's preferred name (alias) versus their legal name.

John Terry Heather goes by "Terry": shift boards and rosters must say
"Terry Heather", while reports, certificates and ballots keep "John Heather".
"""

import uuid
from unittest.mock import AsyncMock, patch

import pydantic
import pytest
from sqlalchemy import select

from app.api.v1.endpoints.users import update_user_profile
from app.models.user import Organization, User, UserStatus
from app.schemas.user import AdminUserCreate, UserListResponse, UserUpdate
from app.utils.member_names import format_display_name, format_legal_name


@pytest.mark.unit
class TestNameFormatting:
    def test_preferred_name_replaces_first_name(self):
        assert format_display_name("John", "Heather", "Terry") == "Terry Heather"

    def test_no_preferred_name_falls_back_to_first(self):
        assert format_display_name("John", "Heather", None) == "John Heather"
        assert format_display_name("John", "Heather", "   ") == "John Heather"

    def test_legal_name_ignores_preferred_name(self):
        assert format_legal_name("John", "Heather") == "John Heather"

    def test_missing_parts_leave_no_stray_spaces_or_none(self):
        assert format_display_name(None, "Heather", None) == "Heather"
        assert format_display_name("John", None, None) == "John"
        assert format_legal_name(None, None) == ""

    def test_full_name_never_spells_out_a_missing_part(self):
        assert User(first_name=None, last_name="Heather").full_name == "Heather"
        assert User(first_name=None, last_name=None).full_name == ""

    def test_user_properties(self):
        user = User(first_name="John", last_name="Heather", preferred_name="Terry")
        assert user.display_name == "Terry Heather"
        assert user.full_name == "John Heather"

        user.preferred_name = None
        assert user.display_name == "John Heather"


@pytest.mark.unit
class TestSchemas:
    def test_blank_preferred_name_clears_to_null(self):
        assert UserUpdate(preferred_name="  ").preferred_name is None
        assert UserUpdate(preferred_name=" Terry ").preferred_name == "Terry"

    def test_explicit_null_is_kept_as_a_set_field(self):
        """Clearing must reach the endpoint as a set key, not be dropped."""
        dumped = UserUpdate(preferred_name=None).model_dump(exclude_unset=True)
        assert dumped == {"preferred_name": None}

    def test_length_is_capped(self):
        with pytest.raises(pydantic.ValidationError):
            UserUpdate(preferred_name="x" * 101)

    def test_admin_create_accepts_preferred_name(self):
        body = AdminUserCreate(
            username="theather",
            email="theather@example.com",
            first_name="John",
            last_name="Heather",
            preferred_name="Terry",
        )
        assert body.preferred_name == "Terry"

    def test_list_response_serializes_both_names(self):
        user = User(
            id=str(uuid.uuid4()),
            organization_id=str(uuid.uuid4()),
            username="theather",
            first_name="John",
            last_name="Heather",
            preferred_name="Terry",
            status=UserStatus.ACTIVE,
            compliance_exempt=False,
        )
        payload = UserListResponse.model_validate(user)
        assert payload.full_name == "John Heather"
        assert payload.display_name == "Terry Heather"
        assert payload.preferred_name == "Terry"


async def _make_member(db_session) -> User:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Preferred Name Test Department",
        slug=f"pref-name-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"theather-{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@pref-name.test",
        first_name="John",
        middle_name="Terry",
        last_name="Heather",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.integration
class TestSelfServiceUpdate:
    async def _update(self, db_session, member, body):
        with patch(
            "app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()
        ) as audit:
            response = await update_user_profile(
                uuid.UUID(member.id), body, db_session, member
            )
        return response, audit

    async def _stored(self, db_session, member_id: str) -> User:
        db_session.expire_all()
        return (
            await db_session.execute(select(User).where(User.id == member_id))
        ).scalar_one()

    async def test_member_sets_their_own_preferred_name(self, db_session):
        member = await _make_member(db_session)
        member_id = member.id

        response, audit = await self._update(
            db_session, member, UserUpdate(preferred_name="Terry")
        )

        stored = await self._stored(db_session, member_id)
        assert stored.preferred_name == "Terry"
        assert stored.first_name == "John"
        assert response.display_name == "Terry Heather"
        assert response.full_name == "John Heather"

        event_data = audit.await_args.kwargs["event_data"]
        assert event_data["preferred_name_change"] == {
            "from": None,
            "to": "Terry",
        }

    async def test_explicit_null_clears_it(self, db_session):
        member = await _make_member(db_session)
        member_id = member.id
        await self._update(db_session, member, UserUpdate(preferred_name="Terry"))

        _, audit = await self._update(
            db_session, member, UserUpdate(preferred_name=None)
        )

        stored = await self._stored(db_session, member_id)
        assert stored.preferred_name is None
        assert stored.display_name == "John Heather"
        assert audit.await_args.kwargs["event_data"]["preferred_name_change"] == {
            "from": "Terry",
            "to": None,
        }

    async def test_unrelated_update_leaves_it_alone(self, db_session):
        member = await _make_member(db_session)
        member_id = member.id
        await self._update(db_session, member, UserUpdate(preferred_name="Terry"))

        _, audit = await self._update(db_session, member, UserUpdate(phone="555-0100"))

        stored = await self._stored(db_session, member_id)
        assert stored.preferred_name == "Terry"
        assert "preferred_name_change" not in audit.await_args.kwargs["event_data"]
