"""
Member phone and mobile numbers are validated on new writes (W04-7).

A member saved "call me maybe" as their phone, and the urgent-text switch
then counted it as somewhere to send a text. The owner chose lenient
validation — digits, a leading +, spaces, dashes, dots, parentheses and an
extension — on new writes only: a number already stored can be sent back
unchanged, so a member with a legacy value can still save the rest of their
profile.
"""

import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.users import update_contact_info, update_user_profile
from app.models.user import Organization, User, UserStatus
from app.schemas.user import AdminUserCreate, ContactInfoUpdate, UserUpdate
from app.utils.phone_numbers import is_valid_member_phone, validate_member_phone


class TestRule:
    pytestmark = [pytest.mark.unit]

    @pytest.mark.parametrize(
        "value",
        [
            "703-555-0101",
            "(703) 555-0101",
            "703.555.0101",
            "+1 703 555 0101",
            "+44 20 7946 0958",
            "703-555-0101 ext 4",
            "703-555-0101 ext. 12",
            "7035550101x123",
            "555-0101",
        ],
    )
    def test_accepts_ordinary_numbers(self, value):
        assert is_valid_member_phone(value)

    @pytest.mark.parametrize(
        "value",
        [
            "call me maybe",
            "555-01",  # too few digits
            "1234567890123456",  # too many for E.164
            "703+555+0101",
            "703-555-0101 ext",
            "n/a",
        ],
    )
    def test_refuses_what_is_not_a_number(self, value):
        assert not is_valid_member_phone(value)

    def test_blank_clears(self):
        assert validate_member_phone("   ") is None
        assert validate_member_phone(None) is None

    def test_an_unchanged_stored_value_passes(self):
        assert (
            validate_member_phone("call me maybe", "call me maybe") == "call me maybe"
        )
        with pytest.raises(ValueError, match="Enter a phone number"):
            validate_member_phone("call me later", "call me maybe")

    def test_create_schema_refuses_a_bad_number(self):
        base = dict(
            username="newmember",
            email="new@example.org",
            first_name="New",
            last_name="Member",
        )
        AdminUserCreate(**base, phone="703-555-0101", mobile="+1 703 555 0199")
        with pytest.raises(ValidationError):
            AdminUserCreate(**base, phone="call me maybe")
        with pytest.raises(ValidationError):
            AdminUserCreate(**base, mobile="text me")


async def _member(db_session, **overrides) -> User:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Phone Department",
        slug=f"phone-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    handle = uuid.uuid4().hex[:10]
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{handle}",
        email=f"{handle}@phone.test",
        first_name="Pat",
        last_name="Phone",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    fields.update(overrides)
    user = User(**fields)
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.mark.integration
class TestUpdatePaths:
    async def test_contact_info_refuses_a_new_bad_number(self, db_session):
        member = await _member(db_session, phone="703-555-0101")

        with pytest.raises(HTTPException) as exc:
            await update_contact_info(
                user_id=uuid.UUID(member.id),
                contact_update=ContactInfoUpdate(phone="call me maybe"),
                db=db_session,
                current_user=member,
            )

        assert exc.value.status_code == 400
        assert exc.value.detail.startswith("Phone:")
        assert member.phone == "703-555-0101"

    async def test_contact_info_keeps_a_legacy_value_sent_back(self, db_session):
        member = await _member(db_session, phone="call me maybe")

        await update_contact_info(
            user_id=uuid.UUID(member.id),
            contact_update=ContactInfoUpdate(
                phone="call me maybe", mobile="(703) 555-0199"
            ),
            db=db_session,
            current_user=member,
        )

        assert member.phone == "call me maybe"
        assert member.mobile == "(703) 555-0199"

    async def test_contact_info_blank_clears(self, db_session):
        member = await _member(db_session, mobile="call me maybe")

        await update_contact_info(
            user_id=uuid.UUID(member.id),
            contact_update=ContactInfoUpdate(mobile=""),
            db=db_session,
            current_user=member,
        )

        assert member.mobile is None

    async def test_profile_refuses_a_new_bad_mobile(self, db_session):
        member = await _member(db_session)

        with pytest.raises(HTTPException) as exc:
            await update_user_profile(
                user_id=uuid.UUID(member.id),
                profile_update=UserUpdate(mobile="text me"),
                db=db_session,
                current_user=member,
            )

        assert exc.value.status_code == 400
        assert exc.value.detail.startswith("Mobile:")
        assert member.mobile is None
