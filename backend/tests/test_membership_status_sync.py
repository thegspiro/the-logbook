"""Membership type drives account status, one way (owner decision 2026-10-20).

``UserStatus.PROBATIONARY`` and a membership type of ``probationary`` were two
facts that nothing connected: a member added as a probationary member had an
active account, an officer's by-hand "probationary" status never moved when
the tier ladder advanced the member, and the two screens that showed them
disagreed. These assertions pin the one-way rule: writing a membership type
moves the account status between ``active`` and ``probationary`` only, never
off leave, suspension, retirement or a drop; and a save that does not touch
membership leaves a by-hand status exactly where the officer put it.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm.attributes import set_committed_value

from app.models.user import (
    STATUS_FOLLOWS_MEMBERSHIP_REASON,
    User,
    UserStatus,
    _reconcile_membership,
    account_status_for_membership,
    sync_account_status_with_membership,
)
from app.utils.membership import MemberClass, MemberStatus


@pytest.mark.unit
class TestTheRule:
    @pytest.mark.parametrize(
        ("membership_type", "status", "expected"),
        [
            ("probationary", UserStatus.ACTIVE, UserStatus.PROBATIONARY),
            ("Probationary ", UserStatus.ACTIVE, UserStatus.PROBATIONARY),
            ("probationary", None, UserStatus.PROBATIONARY),
            ("active", UserStatus.PROBATIONARY, UserStatus.ACTIVE),
            ("life", UserStatus.PROBATIONARY, UserStatus.ACTIVE),
            ("administrative", UserStatus.PROBATIONARY, UserStatus.ACTIVE),
            # A custom tier id is "not probationary" too — the member advanced
            # off the rung.
            ("senior", UserStatus.PROBATIONARY, UserStatus.ACTIVE),
            ("senior", "probationary", UserStatus.ACTIVE),
            # The standing in its stored spelling, which is what the
            # reconciler hands the helper after a flush.
            ("regular", UserStatus.PROBATIONARY, UserStatus.ACTIVE),
        ],
    )
    def test_moves_between_active_and_probationary(
        self, membership_type, status, expected
    ):
        assert account_status_for_membership(membership_type, status) is expected

    @pytest.mark.parametrize(
        "status",
        [
            UserStatus.INACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.LEAVE,
            UserStatus.RETIRED,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
            UserStatus.ARCHIVED,
        ],
    )
    @pytest.mark.parametrize("membership_type", ["probationary", "active", "senior"])
    def test_every_other_status_is_protected(self, membership_type, status):
        assert account_status_for_membership(membership_type, status) is None

    def test_already_in_step_is_left_alone(self):
        assert (
            account_status_for_membership("probationary", UserStatus.PROBATIONARY)
            is None
        )
        assert account_status_for_membership("active", UserStatus.ACTIVE) is None
        assert account_status_for_membership(None, UserStatus.ACTIVE) is None


def _member(**committed):
    """A member as loaded from the database, carrying no history."""
    member = User(
        organization_id="org-1",
        username="pat",
        email="pat@fd.test",
        password_hash="x",
    )
    defaults = {
        "status": UserStatus.ACTIVE,
        "membership_type": "active",
        "member_class": MemberClass.OPERATIONAL,
        "member_status": MemberStatus.REGULAR,
        "status_changed_at": None,
        "status_change_reason": None,
    }
    defaults.update(committed)
    for field, value in defaults.items():
        set_committed_value(member, field, value)
    return member


@pytest.mark.unit
class TestTheFlushListener:
    def test_a_legacy_write_to_probationary_puts_the_account_on_probation(self):
        member = _member()
        member.membership_type = "probationary"
        _reconcile_membership(None, None, member)
        assert member.status is UserStatus.PROBATIONARY
        assert member.status_change_reason == (
            f"{STATUS_FOLLOWS_MEMBERSHIP_REASON} 'probationary'"
        )
        assert member.status_changed_at is not None

    def test_a_class_status_write_does_the_same(self):
        member = _member()
        member.member_status = MemberStatus.PROBATIONARY
        _reconcile_membership(None, None, member)
        assert member.membership_type == "probationary"
        assert member.status is UserStatus.PROBATIONARY

    def test_leaving_probation_restores_active(self):
        member = _member(
            status=UserStatus.PROBATIONARY,
            membership_type="probationary",
            member_status=MemberStatus.PROBATIONARY,
        )
        member.membership_type = "active"
        _reconcile_membership(None, None, member)
        assert member.status is UserStatus.ACTIVE

    def test_advancing_onto_a_custom_tier_restores_active(self):
        member = _member(
            status=UserStatus.PROBATIONARY,
            membership_type="probationary",
            member_status=MemberStatus.PROBATIONARY,
        )
        member.membership_type = "senior"
        _reconcile_membership(None, None, member)
        assert member.status is UserStatus.ACTIVE
        # The tier id is the standing now, and the status rule reads it.
        assert member.member_status == "senior"

    def test_a_tier_that_counts_as_probationary_puts_the_account_on_probation(
        self,
    ):
        """A department's "cadet" rung that counts as probationary."""
        member = _member()
        moved = sync_account_status_with_membership(
            member, member_status="cadet", ranks_as_by_tier={"cadet": "probationary"}
        )
        assert moved == ("active", "probationary")
        assert member.status is UserStatus.PROBATIONARY

    def test_an_administrative_probationer_is_on_probation(self):
        """Probationary is a standing any class can hold.

        The legacy word collapses an administrative probationer to plain
        ``administrative`` -- "not probationary" -- so judging the account on
        it kept every probationary member outside the operational class off
        probation. Judged on the ladder column, the treasurer serving a
        probationary year starts out on probation like anyone else.
        """
        member = _member()
        member.member_class = MemberClass.ADMINISTRATIVE
        member.member_status = MemberStatus.PROBATIONARY
        _reconcile_membership(None, None, member)
        assert member.membership_type == "administrative"
        assert member.status is UserStatus.PROBATIONARY

    def test_a_member_on_leave_stays_on_leave(self):
        member = _member(status=UserStatus.LEAVE)
        member.membership_type = "probationary"
        _reconcile_membership(None, None, member)
        assert member.status is UserStatus.LEAVE
        assert member.status_change_reason is None

    def test_a_by_hand_probation_survives_an_unrelated_save(self):
        """An officer put an active-type member on probation from the profile.

        Saving their phone number writes nothing about membership, so the
        listener must not "correct" the status back to active.
        """
        member = _member(status=UserStatus.PROBATIONARY)
        member.phone = "555-0100"
        _reconcile_membership(None, None, member)
        assert member.status is UserStatus.PROBATIONARY

    def test_a_fresh_probationary_member_is_inserted_on_probation(self):
        member = User(
            organization_id="org-1",
            username="new",
            email="new@fd.test",
            password_hash="x",
            member_class=MemberClass.OPERATIONAL,
            member_status=MemberStatus.PROBATIONARY,
            status=UserStatus.ACTIVE,
        )
        _reconcile_membership(None, None, member)
        assert member.status is UserStatus.PROBATIONARY

    def test_the_helper_is_idempotent(self):
        member = _member()
        # The standing is passed in, the way an endpoint that has written the
        # legacy column and not yet flushed passes it.
        first = sync_account_status_with_membership(
            member, member_status="probationary"
        )
        second = sync_account_status_with_membership(
            member, member_status="probationary"
        )
        assert first == ("active", "probationary")
        assert second is None


async def _org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, :name, :otype, :slug, :tz, 1)"
        ),
        {
            "id": org_id,
            "name": "Sync FD",
            "otype": "fire_department",
            "slug": f"sync-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.flush()
    return org_id


@pytest.mark.integration
class TestThroughTheDatabase:
    async def test_the_status_follows_the_type_across_writes(self, db_session):
        org_id = await _org(db_session)
        uid = str(uuid.uuid4())
        member = User(
            id=uid,
            organization_id=org_id,
            username=f"s-{uid[:8]}",
            email=f"s-{uid[:8]}@test.com",
            password_hash="x",
            first_name="Sam",
            last_name="Sync",
            status=UserStatus.ACTIVE,
            member_class=MemberClass.OPERATIONAL,
            member_status=MemberStatus.PROBATIONARY,
        )
        db_session.add(member)
        await db_session.flush()

        stored = (
            await db_session.execute(select(User.status).where(User.id == uid))
        ).scalar_one()
        assert stored == UserStatus.PROBATIONARY

        before = datetime.now(timezone.utc) - timedelta(seconds=5)
        member.membership_type = "active"
        await db_session.flush()
        row = (
            await db_session.execute(
                select(
                    User.status, User.status_changed_at, User.status_change_reason
                ).where(User.id == uid)
            )
        ).one()
        assert row.status == UserStatus.ACTIVE
        assert row.status_changed_at.replace(tzinfo=timezone.utc) >= before
        assert row.status_change_reason == (
            f"{STATUS_FOLLOWS_MEMBERSHIP_REASON} 'active'"
        )

        # A by-hand probation holds until the type is next written.
        member.status = UserStatus.PROBATIONARY
        member.phone = "555-0100"
        await db_session.flush()
        held = (
            await db_session.execute(select(User.status).where(User.id == uid))
        ).scalar_one()
        assert held == UserStatus.PROBATIONARY
