"""
Admin-hours review rules a department can set (AH-21).

Two rules, both stored under ``Organization.settings["admin_hours"]`` and read
by ``app/utils/admin_hours_settings.py``:

* ``allow_self_approval`` — a sole-officer department can approve its own
  entries. Off by default, so every installation keeps the AH-4 control.
* ``resync_requeue_growth_percent`` (default 25) — a reopened event's
  correction that grows an already-approved attendance entry by more than the
  threshold, into a length its category would not auto-approve, sends the entry
  back to Pending Review rather than letting the old approval cover the new
  hours.
"""

import uuid
from datetime import datetime, timedelta, timezone

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
from app.services.separation_of_duties import SeparationOfDutiesError
from app.utils.admin_hours_settings import (
    DEFAULT_REQUEUE_GROWTH_PERCENT,
    admin_hours_review_settings_in,
    resync_growth_needs_review,
)


class TestSettingsReader:
    pytestmark = [pytest.mark.unit]

    def test_absent_section_keeps_current_behaviour(self):
        resolved = admin_hours_review_settings_in({})
        assert resolved.allow_self_approval is False
        assert resolved.resync_requeue_growth_percent == 25
        assert admin_hours_review_settings_in(None).allow_self_approval is False

    def test_only_a_literal_true_turns_self_approval_on(self):
        for value in ("true", 1, "yes", None):
            settings = {"admin_hours": {"allow_self_approval": value}}
            assert admin_hours_review_settings_in(settings).allow_self_approval is False
        on = {"admin_hours": {"allow_self_approval": True}}
        assert admin_hours_review_settings_in(on).allow_self_approval is True

    def test_malformed_threshold_reads_as_default(self):
        for value in ("50", -1, 5000, True, 12.5):
            settings = {"admin_hours": {"resync_requeue_growth_percent": value}}
            assert (
                admin_hours_review_settings_in(settings).resync_requeue_growth_percent
                == DEFAULT_REQUEUE_GROWTH_PERCENT
            )
        zero = {"admin_hours": {"resync_requeue_growth_percent": 0}}
        assert admin_hours_review_settings_in(zero).resync_requeue_growth_percent == 0

    def test_threshold_is_strictly_greater_than(self):
        assert resync_growth_needs_review(60, 75, 25) is False
        assert resync_growth_needs_review(60, 76, 25) is True
        assert resync_growth_needs_review(60, 61, 0) is True
        assert resync_growth_needs_review(60, 60, 0) is False
        assert resync_growth_needs_review(60, 30, 0) is False


async def _org(db_session, admin_hours_settings=None) -> Organization:
    settings = {}
    if admin_hours_settings is not None:
        settings["admin_hours"] = admin_hours_settings
    org = Organization(
        id=str(uuid.uuid4()),
        name="Review Rules Department",
        slug=f"ahreview-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings=settings,
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session, org) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"{handle}@ahreview.test",
        first_name="Sole",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _category(db_session, org, **overrides) -> AdminHoursCategory:
    category = AdminHoursCategory(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Meetings {uuid.uuid4().hex[:6]}",
        is_active=True,
        require_approval=True,
        **overrides,
    )
    db_session.add(category)
    await db_session.flush()
    return category


async def _pending_entry(db_session, org, user, category) -> AdminHoursEntry:
    start = datetime.now(timezone.utc) - timedelta(days=1)
    entry = AdminHoursEntry(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=user.id,
        category_id=category.id,
        clock_in_at=start,
        clock_out_at=start + timedelta(hours=2),
        duration_minutes=120,
        entry_method=AdminHoursEntryMethod.MANUAL,
        status=AdminHoursEntryStatus.PENDING,
    )
    db_session.add(entry)
    await db_session.flush()
    return entry


@pytest.mark.integration
class TestSelfApprovalToggle:
    async def test_self_approval_refused_by_default(self, db_session):
        org = await _org(db_session)
        officer = await _user(db_session, org)
        entry = await _pending_entry(
            db_session, org, officer, await _category(db_session, org)
        )

        with pytest.raises(SeparationOfDutiesError):
            await AdminHoursService(db_session).approve_or_reject(
                entry.id, org.id, officer.id, "approve"
            )

    async def test_self_approval_allowed_when_department_turns_it_on(self, db_session):
        org = await _org(db_session, {"allow_self_approval": True})
        officer = await _user(db_session, org)
        entry = await _pending_entry(
            db_session, org, officer, await _category(db_session, org)
        )

        approved = await AdminHoursService(db_session).approve_or_reject(
            entry.id, org.id, officer.id, "approve"
        )

        assert approved.status == AdminHoursEntryStatus.APPROVED
        # Recorded as a self-approval, so it stays visible as one.
        assert approved.approved_by == officer.id == approved.user_id

    async def test_bulk_approve_follows_the_toggle(self, db_session):
        off_org = await _org(db_session)
        off_officer = await _user(db_session, off_org)
        off_entry = await _pending_entry(
            db_session,
            off_org,
            off_officer,
            await _category(db_session, off_org),
        )
        on_org = await _org(db_session, {"allow_self_approval": True})
        on_officer = await _user(db_session, on_org)
        on_entry = await _pending_entry(
            db_session,
            on_org,
            on_officer,
            await _category(db_session, on_org),
        )
        svc = AdminHoursService(db_session)

        assert await svc.bulk_approve([off_entry.id], off_org.id, off_officer.id) == 0
        assert await svc.bulk_approve([on_entry.id], on_org.id, on_officer.id) == 1
        assert off_entry.status == AdminHoursEntryStatus.PENDING
        assert on_entry.status == AdminHoursEntryStatus.APPROVED


async def _attendance(db_session, org, member, category):
    """An event mapped 100% to ``category`` and one attendee's RSVP."""
    now = datetime.now(timezone.utc)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Monthly meeting",
        event_type="business_meeting",
        start_datetime=now - timedelta(days=1),
        end_datetime=now - timedelta(days=1) + timedelta(hours=1),
    )
    db_session.add(event)
    await db_session.flush()
    rsvp = EventRSVP(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        event_id=event.id,
        user_id=member.id,
    )
    db_session.add(
        EventHourMapping(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            event_type="business_meeting",
            admin_hours_category_id=category.id,
            percentage=100,
            is_active=True,
        )
    )
    db_session.add(rsvp)
    await db_session.flush()
    return event, rsvp


async def _credit(svc, org, member, event, rsvp, minutes, *, resync):
    start = event.start_datetime
    return await svc.credit_event_attendance(
        organization_id=org.id,
        user_id=member.id,
        event_id=event.id,
        rsvp_id=rsvp.id,
        event_title=event.title,
        check_in_at=start,
        check_out_at=start + timedelta(minutes=minutes),
        duration_minutes=minutes,
        event_type="business_meeting",
        custom_category=None,
        resync=resync,
    )


async def _entry_for(db_session, rsvp) -> AdminHoursEntry:
    return (
        await db_session.execute(
            select(AdminHoursEntry).where(AdminHoursEntry.source_rsvp_id == rsvp.id)
        )
    ).scalar_one()


@pytest.mark.integration
class TestResyncRequeue:
    async def _approved_hour(self, db_session, org_settings=None, **category_args):
        org = await _org(db_session, org_settings)
        member = await _user(db_session, org)
        officer = await _user(db_session, org)
        category = await _category(db_session, org, **category_args)
        event, rsvp = await _attendance(db_session, org, member, category)
        svc = AdminHoursService(db_session)
        await _credit(svc, org, member, event, rsvp, 60, resync=False)
        entry = await _entry_for(db_session, rsvp)
        if entry.status == AdminHoursEntryStatus.PENDING:
            await svc.approve_or_reject(entry.id, org.id, officer.id, "approve")
        assert entry.status == AdminHoursEntryStatus.APPROVED
        return svc, org, member, event, rsvp, entry

    async def test_growth_past_threshold_goes_back_for_review(self, db_session):
        svc, org, member, event, rsvp, entry = await self._approved_hour(db_session)

        await _credit(svc, org, member, event, rsvp, 180, resync=True)

        assert entry.duration_minutes == 180
        assert entry.status == AdminHoursEntryStatus.PENDING
        assert entry.approved_by is None
        assert entry.approved_at is None

    async def test_small_correction_keeps_the_approval(self, db_session):
        svc, org, member, event, rsvp, entry = await self._approved_hour(db_session)

        await _credit(svc, org, member, event, rsvp, 75, resync=True)

        assert entry.duration_minutes == 75
        assert entry.status == AdminHoursEntryStatus.APPROVED
        assert entry.approved_by is not None

    async def test_department_threshold_is_honoured(self, db_session):
        svc, org, member, event, rsvp, entry = await self._approved_hour(
            db_session, {"resync_requeue_growth_percent": 0}
        )

        await _credit(svc, org, member, event, rsvp, 65, resync=True)

        assert entry.status == AdminHoursEntryStatus.PENDING

    async def test_growth_the_category_would_auto_approve_stays_approved(
        self, db_session
    ):
        svc, org, member, event, rsvp, entry = await self._approved_hour(
            db_session, auto_approve_under_hours=4
        )
        # Under the 4-hour auto-approve line before and after the correction,
        # so no review was ever due.
        await _credit(svc, org, member, event, rsvp, 180, resync=True)

        assert entry.status == AdminHoursEntryStatus.APPROVED
