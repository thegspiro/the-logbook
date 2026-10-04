"""
A probationary member is a current member: they sign in and can be scheduled.

``User.is_active`` meant ``status == ACTIVE`` only. ``PROBATIONARY`` is a real
account status — offered in the member profile's "Change status" menu, and the
one a junior member's legacy ``membership_type`` derives to — so every probie
and junior got "Account is inactive" at sign-in, and an officer adding one to
a shift was told they were "no longer active in this organization".
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.core.security import hash_password
from app.models.training import Shift
from app.models.user import ACTIVE_ACCOUNT_STATUSES, User, UserStatus
from app.services.auth_service import AuthService
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]

PASSWORD = "Probie-Passw0rd!2026"


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db_session) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, :name, :otype, :slug, :tz, 1)"
        ),
        {
            "id": org_id,
            "name": "Probie FD",
            "otype": "fire_department",
            "slug": f"probie-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.flush()
    return org_id


async def _member(
    db_session,
    org_id: str,
    status: str,
    deleted: bool = False,
    membership_type: str = "active",
    member_status: str | None = None,
) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, deleted_at, "
            "membership_type, member_status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, :st, :del, :mt, :ms)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "fn": "Ryan",
            "ln": "Hill",
            "em": f"m-{user_id[:8]}@test.com",
            "pw": hash_password(PASSWORD, skip_validation=True),
            "st": status,
            "del": datetime.now(timezone.utc) if deleted else None,
            "mt": membership_type,
            "ms": member_status,
        },
    )
    await db_session.flush()
    return user_id


class TestIsActive:
    def test_probationary_is_an_active_account_status(self):
        assert UserStatus.PROBATIONARY in ACTIVE_ACCOUNT_STATUSES
        assert UserStatus.ACTIVE in ACTIVE_ACCOUNT_STATUSES

    async def test_python_and_sql_forms_agree_for_every_status(self, db_session):
        """The property and its SQL expression are two copies of one rule.

        Login reads the Python form; scheduling, messaging and rosters filter
        with the SQL one. A status admitted by one and not the other is a
        member who can sign in but never be scheduled, or the reverse.
        """
        org_id = await _org(db_session)
        ids = {
            status: await _member(db_session, org_id, status.value)
            for status in UserStatus
        }
        deleted_probie = await _member(db_session, org_id, "probationary", deleted=True)

        selected = set(
            (
                await db_session.execute(
                    select(User.id).where(
                        User.organization_id == org_id, User.is_active
                    )
                )
            )
            .scalars()
            .all()
        )

        for status, user_id in ids.items():
            user = await db_session.get(User, user_id)
            assert user.is_active is (status in ACTIVE_ACCOUNT_STATUSES), status
            assert (user_id in selected) is (status in ACTIVE_ACCOUNT_STATUSES), status
        assert deleted_probie not in selected
        assert (await db_session.get(User, deleted_probie)).is_active is False


class TestSignIn:
    async def test_a_probationary_member_can_sign_in(self, db_session):
        org_id = await _org(db_session)
        user_id = await _member(db_session, org_id, "probationary")
        username = f"m-{user_id[:8]}"

        user, error = await AuthService(db_session).authenticate_user(
            username, PASSWORD
        )

        assert error is None
        assert user is not None
        assert str(user.id) == user_id
        # The login endpoint refuses with "Account is inactive" exactly when
        # this is False.
        assert user.is_active is True

    async def test_a_suspended_member_still_cannot(self, db_session):
        org_id = await _org(db_session)
        user_id = await _member(db_session, org_id, "suspended")

        user, _error = await AuthService(db_session).authenticate_user(
            f"m-{user_id[:8]}", PASSWORD
        )

        assert user is None or user.is_active is False


class TestShiftAssignment:
    async def _shift(self, db_session, org_id: str) -> str:
        start = datetime.now(timezone.utc) + timedelta(days=1)
        # Open to all members with one firefighter seat, so rank and
        # qualifications are not what decides eligibility here; the account
        # status is the only thing these tests vary.
        shift = Shift(
            id=_uid(),
            organization_id=org_id,
            shift_date=date.today() + timedelta(days=1),
            start_time=start,
            end_time=start + timedelta(hours=12),
            positions=[{"position": "firefighter", "required": True}],
            open_to_all_members=True,
        )
        db_session.add(shift)
        await db_session.flush()
        return shift.id

    async def test_an_officer_can_put_a_probationary_member_on_a_shift(
        self, db_session
    ):
        org_id = await _org(db_session)
        officer = await _member(db_session, org_id, "active")
        # A junior member, as stored: status probationary, standing junior.
        probie = await _member(
            db_session,
            org_id,
            "probationary",
            membership_type="probationary",
            member_status="junior",
        )
        shift_id = await self._shift(db_session, org_id)

        assignment, error = await SchedulingService(db_session).create_assignment(
            organization_id=org_id,
            shift_id=shift_id,
            assignment_data={"user_id": probie, "position": "firefighter"},
            assigned_by=officer,
        )

        assert error is None
        assert assignment is not None
        assert str(assignment.user_id) == probie

    async def test_a_suspended_member_is_still_refused(self, db_session):
        org_id = await _org(db_session)
        officer = await _member(db_session, org_id, "active")
        suspended = await _member(db_session, org_id, "suspended")
        shift_id = await self._shift(db_session, org_id)

        assignment, error = await SchedulingService(db_session).create_assignment(
            organization_id=org_id,
            shift_id=shift_id,
            assignment_data={"user_id": suspended, "position": "firefighter"},
            assigned_by=officer,
        )

        assert assignment is None
        assert error is not None
        assert "no longer active" in error
