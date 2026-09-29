"""Per-category stacks in the notification inbox.

The inbox folds unread notifications that share a category into one stack so a
run of validation prompts does not bury everything else. Two backend pieces
feed it: a per-category unread count (the inbox only holds one page, so it
cannot count a stack itself) and a per-category mark-read (clearing a stack is
one request, and covers the rows on pages not yet loaded).

Both share one definition of "stackable" — unread, unpinned, unexpired,
in-app, categorized, the caller's own — and these tests pin each exclusion,
because a count that disagrees with the write leaves a badge the button cannot
clear.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.api.v1.endpoints.notifications import (
    get_my_unread_counts_by_category,
    mark_my_category_read,
)
from app.models.notification import NotificationLog
from app.models.user import Organization, User
from app.services.notifications_service import NotificationsService

pytestmark = pytest.mark.integration


async def _make_org(db):
    org = Organization(name="Stack FD", slug=f"stk-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    user = User(
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"member-{uuid.uuid4().hex[:8]}@example.org",
        first_name="Member",
        last_name="One",
    )
    db.add(user)
    await db.flush()
    return user


async def _log(
    db,
    org,
    user,
    *,
    category,
    channel="in_app",
    read=False,
    pinned=False,
    expires_at=None,
):
    entry = NotificationLog(
        organization_id=org.id,
        recipient_id=user.id,
        recipient_email=user.email,
        channel=channel,
        category=category,
        subject="subject",
        message="body",
        sent_at=datetime(2026, 9, 5, 12, 0, 0),
        read=read,
        pinned=pinned,
        expires_at=expires_at,
    )
    db.add(entry)
    await db.flush()
    return entry


async def _reload(db, entry):
    result = await db.execute(
        select(NotificationLog.read).where(NotificationLog.id == entry.id)
    )
    return result.scalar_one()


class TestUnreadCountsByCategory:
    async def test_counts_only_stackable_rows(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org)
        other = await _make_user(db_session, org)
        past = datetime.now(timezone.utc) - timedelta(hours=1)

        await _log(db_session, org, me, category="event_validation")
        await _log(db_session, org, me, category="event_validation")
        await _log(db_session, org, me, category="shift_validation")
        # Each of these is excluded for a different reason.
        await _log(db_session, org, me, category="event_validation", read=True)
        await _log(db_session, org, me, category="event_validation", pinned=True)
        await _log(db_session, org, me, category="event_validation", expires_at=past)
        await _log(db_session, org, me, category="event_validation", channel="email")
        await _log(db_session, org, me, category=None)
        await _log(db_session, org, other, category="event_validation")

        counts = await NotificationsService(
            db_session
        ).get_user_unread_counts_by_category(org.id, me.id)

        assert counts == {"event_validation": 2, "shift_validation": 1}

    async def test_endpoint_is_scoped_to_the_caller(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org)
        other = await _make_user(db_session, org)
        await _log(db_session, org, other, category="event_validation")

        body = await get_my_unread_counts_by_category(db=db_session, current_user=me)

        assert body == {"categories": {}}


class TestMarkCategoryRead:
    async def test_marks_only_the_named_category_and_reports_the_count(
        self, db_session
    ):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org)
        a = await _log(db_session, org, me, category="event_validation")
        b = await _log(db_session, org, me, category="event_validation")
        untouched = await _log(db_session, org, me, category="shift_validation")

        body = await mark_my_category_read(
            category="event_validation", db=db_session, current_user=me
        )

        assert body == {"marked_read": 2}
        assert await _reload(db_session, a) is True
        assert await _reload(db_session, b) is True
        assert await _reload(db_session, untouched) is False

    async def test_leaves_pinned_rows_and_other_members_alone(self, db_session):
        # A pin keeps one notification in front of the member; clearing the
        # stack it would otherwise belong to must not clear it too.
        org = await _make_org(db_session)
        me = await _make_user(db_session, org)
        other = await _make_user(db_session, org)
        pinned = await _log(
            db_session, org, me, category="event_validation", pinned=True
        )
        theirs = await _log(db_session, org, other, category="event_validation")

        body = await mark_my_category_read(
            category="event_validation", db=db_session, current_user=me
        )

        assert body == {"marked_read": 0}
        assert await _reload(db_session, pinned) is False
        assert await _reload(db_session, theirs) is False

    async def test_count_and_write_agree(self, db_session):
        org = await _make_org(db_session)
        me = await _make_user(db_session, org)
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        await _log(db_session, org, me, category="event_validation")
        await _log(db_session, org, me, category="event_validation", expires_at=past)
        await _log(db_session, org, me, category="event_validation", channel="email")

        service = NotificationsService(db_session)
        before = await service.get_user_unread_counts_by_category(org.id, me.id)
        marked = await service.mark_user_category_read(
            org.id, me.id, "event_validation"
        )
        after = await service.get_user_unread_counts_by_category(org.id, me.id)

        assert marked == before["event_validation"] == 1
        assert after == {}
