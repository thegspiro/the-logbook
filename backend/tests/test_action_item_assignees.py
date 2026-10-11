"""W52-6 and W52-7: action items are assigned to members, and an assignee may
move their own item along.

W52-6 (owner: any active member, old items stay name-only): the minutes
picker lists every active member, an assignee_id must name an active member
of the same department, and the server stores that member's name beside it.

W52-7 (owner: status + notes for assignee_id only): a member without
minutes.manage may change the status and completion notes of an item whose
assignee_id is theirs, and nothing else.
"""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesActionItemStatus,
    MinutesStatus,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.minute import ActionItemCreate, ActionItemUpdate
from app.services.minute_service import MinuteService

pytestmark = pytest.mark.integration


async def _org(db):
    org = Organization(name="Assignee FD", slug=f"asg-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, first, status=UserStatus.ACTIVE):
    user = User(
        organization_id=org.id,
        username=f"{first.lower()}-{uuid.uuid4().hex[:8]}",
        email=f"{first.lower()}-{uuid.uuid4().hex[:8]}@example.org",
        first_name=first,
        last_name="Member",
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


async def _minutes(db, org, status=MinutesStatus.DRAFT):
    minutes = MeetingMinutes(
        organization_id=org.id,
        title="Business meeting",
        meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        status=status,
    )
    db.add(minutes)
    await db.flush()
    return minutes


async def _item(db, minutes, assignee_id=None, assignee_name=None):
    item = ActionItem(
        minutes_id=minutes.id,
        description="Order hose",
        assignee_id=assignee_id,
        assignee_name=assignee_name,
        status=MinutesActionItemStatus.PENDING,
    )
    db.add(item)
    await db.flush()
    return item


class TestAssigneePicker:
    async def test_lists_only_active_members_of_the_department(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        active = await _user(db_session, org, "Alice")
        probationary = await _user(
            db_session, org, "Bob", status=UserStatus.PROBATIONARY
        )
        await _user(db_session, org, "Carol", status=UserStatus.RETIRED)
        await _user(db_session, other, "Dave")

        members = await MinuteService(db_session).list_assignable_members(org.id)

        assert {m["id"] for m in members} == {active.id, probationary.id}
        assert all(set(m) == {"id", "name"} for m in members)

    async def test_add_stores_the_members_name_not_the_typed_one(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        minutes = await _minutes(db_session, org)

        item = await MinuteService(db_session).add_action_item(
            minutes.id,
            org.id,
            ActionItemCreate(
                description="Order hose",
                assignee_id=alice.id,
                assignee_name="someone else",
            ),
        )

        assert item.assignee_id == alice.id
        assert item.assignee_name == alice.display_name

    async def test_add_refuses_an_inactive_or_foreign_member(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        retired = await _user(db_session, org, "Carol", status=UserStatus.RETIRED)
        foreign = await _user(db_session, other, "Dave")
        minutes = await _minutes(db_session, org)
        service = MinuteService(db_session)

        for user in (retired, foreign):
            with pytest.raises(ValueError, match="Invalid assignee"):
                await service.add_action_item(
                    minutes.id,
                    org.id,
                    ActionItemCreate(description="x", assignee_id=user.id),
                )

    async def test_a_name_only_item_is_still_accepted(self, db_session):
        org = await _org(db_session)
        minutes = await _minutes(db_session, org)

        item = await MinuteService(db_session).add_action_item(
            minutes.id,
            org.id,
            ActionItemCreate(description="x", assignee_name="Guest Speaker"),
        )

        assert item.assignee_id is None
        assert item.assignee_name == "Guest Speaker"

    async def test_reassigning_names_the_new_member(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        bob = await _user(db_session, org, "Bob")
        minutes = await _minutes(db_session, org)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        await MinuteService(db_session).update_action_item(
            item.id, minutes.id, org.id, ActionItemUpdate(assignee_id=bob.id)
        )

        assert item.assignee_id == bob.id
        assert item.assignee_name == bob.display_name


class TestAssigneeMayUpdateTheirOwnItem:
    async def test_assignee_changes_status_and_notes(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        minutes = await _minutes(db_session, org, status=MinutesStatus.APPROVED)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        updated = await MinuteService(db_session).update_action_item(
            item.id,
            minutes.id,
            org.id,
            ActionItemUpdate(status="completed", completion_notes="Ordered"),
            as_assignee=alice.id,
        )

        assert updated.status == MinutesActionItemStatus.COMPLETED
        assert updated.completion_notes == "Ordered"
        assert updated.completed_at is not None

    async def test_any_other_field_is_refused(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        minutes = await _minutes(db_session, org)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        with pytest.raises(PermissionError):
            await MinuteService(db_session).update_action_item(
                item.id,
                minutes.id,
                org.id,
                ActionItemUpdate(status="in_progress", description="Changed"),
                as_assignee=alice.id,
            )
        assert item.description == "Order hose"

    async def test_someone_elses_item_reads_as_missing(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        bob = await _user(db_session, org, "Bob")
        minutes = await _minutes(db_session, org)
        theirs = await _item(db_session, minutes, alice.id, alice.display_name)
        by_name = await _item(db_session, minutes, None, bob.display_name)
        service = MinuteService(db_session)

        for item in (theirs, by_name):
            assert (
                await service.update_action_item(
                    item.id,
                    minutes.id,
                    org.id,
                    ActionItemUpdate(status="completed"),
                    as_assignee=bob.id,
                )
                is None
            )


class TestTheEndpointSplit:
    async def _call(self, db, minutes, item, user, can_manage, data):
        from app.api.v1.endpoints import minutes as endpoint

        with (
            patch.object(endpoint, "_has_permission", return_value=can_manage),
            patch.object(endpoint, "_collect_user_permissions", return_value=set()),
            patch.object(endpoint, "log_audit_event", AsyncMock()),
        ):
            return await endpoint.update_action_item(
                minutes.id, item.id, data, db=db, current_user=user
            )

    async def test_member_closes_their_own_item(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        minutes = await _minutes(db_session, org)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        response = await self._call(
            db_session,
            minutes,
            item,
            alice,
            False,
            ActionItemUpdate(status="completed"),
        )

        assert response.status == "completed"

    async def test_member_gets_404_on_another_members_item(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        bob = await _user(db_session, org, "Bob")
        minutes = await _minutes(db_session, org)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        with pytest.raises(HTTPException) as caught:
            await self._call(
                db_session,
                minutes,
                item,
                bob,
                False,
                ActionItemUpdate(status="completed"),
            )
        assert caught.value.status_code == 404

    async def test_member_gets_403_for_a_field_beyond_status(self, db_session):
        org = await _org(db_session)
        alice = await _user(db_session, org, "Alice")
        minutes = await _minutes(db_session, org)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        with pytest.raises(HTTPException) as caught:
            await self._call(
                db_session,
                minutes,
                item,
                alice,
                False,
                ActionItemUpdate(priority="urgent"),
            )
        assert caught.value.status_code == 403

    async def test_manager_still_edits_any_field(self, db_session):
        org = await _org(db_session)
        secretary = await _user(db_session, org, "Sam")
        alice = await _user(db_session, org, "Alice")
        minutes = await _minutes(db_session, org)
        item = await _item(db_session, minutes, alice.id, alice.display_name)

        response = await self._call(
            db_session,
            minutes,
            item,
            secretary,
            True,
            ActionItemUpdate(description="Order two hoses"),
        )

        assert response.description == "Order two hoses"
        stored = await db_session.execute(
            select(ActionItem.description).where(ActionItem.id == item.id)
        )
        assert stored.scalar_one() == "Order two hoses"
