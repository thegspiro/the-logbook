"""Admin hours (app-review B15 pass 6).

- A member clocking out past the category's session limit gets what the
  stale-session sweep would have given: capped at the limit and pending.
- A manual entry inside a member's open session is an overlap.
- A category limit too large for a timedelta no longer takes down the sweep.
- Re-crediting an event re-typed to one that maps to nothing removes the
  credit the earlier type made.
- A 0-minute entry exports as 0 hours, not a blank.
- Approve, reject and bulk approve are audited.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
    EventHourMapping,
)
from app.models.event import Event, EventRSVP
from app.models.user import Organization, User, UserStatus
from app.services.admin_hours_service import AdminHoursService


async def _org(db):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Pass6 Hours FD",
        slug=f"ah6-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={},
    )
    db.add(org)
    await db.flush()
    return org


async def _member(db, org):
    tag = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{tag}",
        email=f"{tag}@ah6.test",
        first_name="P",
        last_name="M",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


async def _category(db, org, **fields):
    category = AdminHoursCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Cat {uuid.uuid4().hex[:6]}",
        is_active=True,
        **fields,
    )
    db.add(category)
    await db.flush()
    return category


async def _open_session(db, org, user, category, hours_ago):
    entry = AdminHoursEntry(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        category_id=category.id,
        clock_in_at=datetime.now(timezone.utc) - timedelta(hours=hours_ago),
        entry_method=AdminHoursEntryMethod.QR_SCAN,
        status=AdminHoursEntryStatus.ACTIVE,
    )
    db.add(entry)
    await db.flush()
    return entry


@pytest.mark.integration
class TestClockOutPastTheLimit:
    async def test_is_capped_and_sent_for_review(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        # The seeded shape: no approval needed, so an uncapped session was
        # approved outright.
        category = await _category(
            db_session, org, require_approval=False, max_hours_per_session=1.0
        )
        session = await _open_session(db_session, org, member, category, hours_ago=30)

        out = await AdminHoursService(db_session).clock_out(
            session.id, member.id, org.id
        )

        assert out.status == AdminHoursEntryStatus.PENDING
        assert out.duration_minutes == 60
        assert "Auto-closed: exceeded 1.0h session limit" in (out.description or "")
        clock_in = out.clock_in_at.replace(tzinfo=timezone.utc)
        assert out.clock_out_at.replace(tzinfo=timezone.utc) - clock_in == timedelta(
            hours=1
        )

    async def test_within_the_limit_is_unchanged(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        category = await _category(
            db_session, org, require_approval=False, max_hours_per_session=12.0
        )
        session = await _open_session(db_session, org, member, category, hours_ago=2)

        out = await AdminHoursService(db_session).clock_out(
            session.id, member.id, org.id
        )

        assert out.status == AdminHoursEntryStatus.APPROVED
        assert 119 <= out.duration_minutes <= 121


@pytest.mark.integration
class TestOverlapWithAnOpenSession:
    async def test_a_manual_entry_inside_an_open_session_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        category = await _category(
            db_session, org, require_approval=False, max_hours_per_session=12.0
        )
        await _open_session(db_session, org, member, category, hours_ago=3)
        now = datetime.now(timezone.utc)

        with pytest.raises(ValueError, match="overlap"):
            await AdminHoursService(db_session).create_manual_entry(
                org.id,
                member.id,
                category.id,
                now - timedelta(hours=2),
                now - timedelta(hours=1),
                "Also logged by hand",
            )

    async def test_a_manual_entry_before_the_session_is_accepted(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        category = await _category(
            db_session, org, require_approval=False, max_hours_per_session=12.0
        )
        await _open_session(db_session, org, member, category, hours_ago=1)
        now = datetime.now(timezone.utc)

        entry = await AdminHoursService(db_session).create_manual_entry(
            org.id,
            member.id,
            category.id,
            now - timedelta(hours=4),
            now - timedelta(hours=3),
            "Earlier shift",
        )

        assert entry.duration_minutes == 60


@pytest.mark.integration
class TestSweepSurvivesAnAbsurdLimit:
    async def test_other_sessions_are_still_closed(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        other = await _member(db_session, org)
        absurd = await _category(
            db_session, org, require_approval=True, max_hours_per_session=1e11
        )
        hourly = await _category(
            db_session, org, require_approval=True, max_hours_per_session=1.0
        )
        await _open_session(db_session, org, member, absurd, hours_ago=1)
        stale = await _open_session(db_session, org, other, hourly, hours_ago=5)

        closed = await AdminHoursService(db_session).auto_close_stale_sessions(org.id)

        assert closed == 1
        assert stale.status == AdminHoursEntryStatus.PENDING
        assert stale.duration_minutes == 60


@pytest.mark.integration
class TestEventResync:
    async def test_retyping_to_an_unmapped_type_removes_the_credit(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org)
        category = await _category(db_session, org, require_approval=False)
        now = datetime.now(timezone.utc)
        event = Event(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            title="Outreach",
            event_type="public_education",
            start_datetime=now - timedelta(days=1),
            end_datetime=now - timedelta(days=1) + timedelta(hours=2),
        )
        db_session.add(event)
        await db_session.flush()
        rsvp = EventRSVP(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            event_id=event.id,
            user_id=member.id,
        )
        db_session.add(rsvp)
        db_session.add(
            EventHourMapping(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                event_type="public_education",
                admin_hours_category_id=category.id,
                percentage=100,
                is_active=True,
            )
        )
        await db_session.flush()
        service = AdminHoursService(db_session)
        credit = dict(
            organization_id=org.id,
            user_id=member.id,
            event_id=event.id,
            rsvp_id=rsvp.id,
            event_title="Outreach",
            check_in_at=event.start_datetime,
            check_out_at=event.start_datetime + timedelta(minutes=120),
            duration_minutes=120,
            custom_category=None,
        )
        await service.credit_event_attendance(
            event_type="public_education", resync=True, **credit
        )

        await service.credit_event_attendance(
            event_type="business_meeting", resync=True, **credit
        )

        left = (
            (
                await db_session.execute(
                    select(AdminHoursEntry).where(
                        AdminHoursEntry.source_rsvp_id == rsvp.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert left == []


@pytest.mark.unit
class TestReviewIsAudited:
    async def test_a_single_review_is_audited(self):
        from app.api.v1.endpoints import admin_hours as endpoints

        entry = SimpleNamespace(
            id="e-1",
            organization_id="org-1",
            user_id="member-1",
            category_id="cat-1",
            clock_in_at=None,
            clock_out_at=None,
            duration_minutes=60,
            description=None,
            entry_method=AdminHoursEntryMethod.MANUAL,
            status=AdminHoursEntryStatus.REJECTED,
            approved_by="officer-1",
            approved_at=None,
            rejection_reason="Wrong day",
            created_at=None,
            updated_at=None,
        )
        officer = SimpleNamespace(
            id="officer-1",
            username="officer",
            organization_id="org-1",
            display_name="Officer",
        )
        audit = AsyncMock()
        with patch.object(
            endpoints.AdminHoursService,
            "approve_or_reject",
            AsyncMock(return_value=entry),
        ), patch.object(
            endpoints.AdminHoursService, "get_category", AsyncMock(return_value=None)
        ), patch.object(
            endpoints, "log_audit_event", audit
        ):
            await endpoints.review_entry(
                entry_id="e-1",
                data=endpoints.AdminHoursApprovalAction(
                    action="reject", rejection_reason="Wrong day"
                ),
                db=AsyncMock(),
                current_user=officer,
            )

        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "admin_hours.entry_reviewed"
        assert kwargs["event_data"] == {
            "entry_id": "e-1",
            "member_user_id": "member-1",
            "action": "reject",
            "self_review": False,
        }

    async def test_a_bulk_approval_is_audited(self):
        from app.api.v1.endpoints import admin_hours as endpoints

        officer = SimpleNamespace(
            id="officer-1", username="officer", organization_id="org-1"
        )
        audit = AsyncMock()
        with patch.object(
            endpoints.AdminHoursService, "bulk_approve", AsyncMock(return_value=2)
        ), patch.object(endpoints, "log_audit_event", audit):
            await endpoints.bulk_approve_entries(
                data=endpoints.AdminHoursBulkApproveRequest(
                    entry_ids=["e-1", "e-2", "e-3"]
                ),
                db=AsyncMock(),
                current_user=officer,
            )

        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_data"] == {
            "requested_entry_ids": ["e-1", "e-2", "e-3"],
            "approved_count": 2,
        }
