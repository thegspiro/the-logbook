"""
The members list must load when a member carries a placeholder address.

The Logbook writes addresses under the reserved ``.invalid`` top-level domain
(RFC 2606) itself, on purpose, so mail can never reach a stranger:

  * the shift history import creates an archived former member the file gave
    no email for as ``former-member-<hex>@import.invalid``;
  * anonymizing a member rewrites their address to
    ``anon-<hex>@anonymized.invalid``.

The user response schemas declared ``email`` as ``EmailStr``, whose validator
refuses special-use domains. One such row made ``GET /users/with-roles`` raise
a ValidationError and answer 500, so Member Management showed "Unable to load
members and roles" for the whole department, and the member's own profile
(``GET /users/{id}/with-roles``) failed the same way. A response reports what
is stored; addresses are validated where they are written.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.users import get_user_with_roles, list_users_with_roles
from app.models.user import User, UserStatus
from app.schemas.user import ContactInfoUpdate, UserCreate
from tests.fake_request import fake_request

pytestmark = [pytest.mark.unit]

IMPORT_PLACEHOLDER = "former-member-602c0f4b05aa@import.invalid"
ANONYMIZED_PLACEHOLDER = "anon-0123456789ab@anonymized.invalid"


def _member(org_id: str, email: str, status: UserStatus, last_name: str) -> User:
    now = datetime.now(timezone.utc)
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=email,
        first_name="Pat",
        last_name=last_name,
        status=status,
        compliance_exempt=False,
        email_verified=False,
        mfa_enabled=False,
        created_at=now,
        updated_at=now,
    )
    user.positions = []
    return user


def _caller(org_id: str, permissions: list[str]) -> MagicMock:
    caller = MagicMock()
    caller.id = str(uuid.uuid4())
    caller.username = "caller"
    caller.organization_id = org_id
    # Permissions aggregate from positions; a falsy rank skips the rank lookup.
    position = MagicMock()
    position.permissions = permissions
    caller.positions = [position]
    caller.rank = None
    return caller


def _list_db(users: list[User]) -> MagicMock:
    """The roster query, then (for a members-manager) the passkey query."""
    roster = MagicMock()
    roster.scalars.return_value.all.return_value = users
    passkeys = MagicMock()
    passkeys.scalars.return_value.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[roster, passkeys])
    return db


@pytest.fixture
def org_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def roster(org_id: str) -> list[User]:
    return [
        _member(org_id, "active@example.org", UserStatus.ACTIVE, "Active"),
        _member(org_id, IMPORT_PLACEHOLDER, UserStatus.ARCHIVED, "Imported"),
        _member(org_id, ANONYMIZED_PLACEHOLDER, UserStatus.ARCHIVED, "Anonymized"),
    ]


class TestMembersListWithPlaceholderAddresses:
    @pytest.mark.parametrize(
        "permissions", [["members.manage"], ["users.view"]], ids=["admin", "viewer"]
    )
    async def test_the_list_loads(self, org_id, roster, permissions):
        with patch(
            "app.api.v1.endpoints.users._load_contact_visibility",
            new=AsyncMock(return_value={"show_email": True}),
        ):
            result = await list_users_with_roles(
                db=_list_db(roster), current_user=_caller(org_id, permissions)
            )

        assert [r.last_name for r in result] == ["Active", "Imported", "Anonymized"]

    async def test_a_members_manager_sees_the_placeholder_as_stored(
        self, org_id, roster
    ):
        with patch(
            "app.api.v1.endpoints.users._load_contact_visibility",
            new=AsyncMock(return_value={}),
        ):
            result = await list_users_with_roles(
                db=_list_db(roster), current_user=_caller(org_id, ["members.manage"])
            )

        assert [r.email for r in result] == [
            "active@example.org",
            IMPORT_PLACEHOLDER,
            ANONYMIZED_PLACEHOLDER,
        ]


class TestProfileWithPlaceholderAddress:
    async def test_the_imported_members_profile_loads(self, org_id):
        subject = _member(org_id, IMPORT_PLACEHOLDER, UserStatus.ARCHIVED, "Imported")
        db = MagicMock()
        found = MagicMock()
        found.scalar_one_or_none = MagicMock(return_value=subject)
        db.execute = AsyncMock(return_value=found)

        with (
            patch("app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()),
            patch(
                "app.api.v1.endpoints.users._load_contact_visibility",
                new=AsyncMock(return_value={}),
            ),
        ):
            result = await get_user_with_roles(
                user_id=uuid.UUID(subject.id),
                db=db,
                current_user=_caller(org_id, ["members.manage"]),
                request=fake_request(),
            )

        assert result.email == IMPORT_PLACEHOLDER


class TestWritesStillValidateTheAddress:
    """Relaxing the response must not relax what a person can type in."""

    def test_create_refuses_a_reserved_domain(self):
        with pytest.raises(ValidationError, match="special-use or reserved"):
            UserCreate(
                username="newmember",
                email="someone@import.invalid",
                password="Unused-Password-1!",
            )

    def test_a_contact_change_refuses_a_reserved_domain(self):
        with pytest.raises(ValidationError, match="special-use or reserved"):
            ContactInfoUpdate(email="someone@import.invalid")
