"""
Test Module for Guest (Non-Member) QR Check-In

Covers the unauthenticated sign-in path used by visitors at outreach events —
volunteer interest nights, open houses — who scan the guest QR code on a room
display and record their own attendance without an account.

Test Coverage:
- Guest check-in is refused unless the event opts in
- Check-in window gating (no early grace for anonymous callers)
- Attendance rows are created, and a repeat scan updates rather than duplicates
- A prospective-member record is opened when the event enables it
- An existing prospect is reused instead of duplicated
- Pipeline failures never cost the guest their attendance
- Prospect/event links are not double-inserted
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import CheckInWindowType, Event, EventExternalAttendee, EventType
from app.services.guest_check_in_service import GuestCheckInService

# ---- Factory helpers ----


def _make_event(**overrides):
    """Create an event that is currently inside its check-in window."""
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        title="Volunteer Interest Night",
        event_type=EventType.PUBLIC_EDUCATION,
        start_datetime=now - timedelta(minutes=10),
        end_datetime=now + timedelta(hours=2),
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        allow_guest_check_in=True,
        guest_check_in_creates_prospect=False,
        is_cancelled=False,
    )
    defaults.update(overrides)
    return Event(**defaults)


def _mock_db(existing_attendee=None, existing_link=None):
    """AsyncMock session whose SELECTs answer from the supplied rows.

    Attendee lookups and prospect-event-link lookups are told apart by the
    entity each query targets, so the service can issue them in any order.
    """
    mock_db = AsyncMock(spec=AsyncSession)
    added = []

    async def mock_execute(statement, *args, **kwargs):
        result = MagicMock()
        text = str(statement)
        if "event_external_attendees" in text:
            row = existing_attendee
        elif "prospect_event_links" in text:
            row = existing_link
        else:
            row = None
        scalars = MagicMock()
        scalars.first.return_value = row
        result.scalars.return_value = scalars
        result.scalar_one_or_none.return_value = row
        return result

    mock_db.execute = mock_execute
    mock_db.add = MagicMock(side_effect=added.append)
    mock_db.added = added
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.refresh = AsyncMock()
    return mock_db


def _patch_pipeline(service, monkeypatch, existing=None, created=None, raises=None):
    """Stub MembershipPipelineService so no real pipeline work is attempted."""
    fake = MagicMock()
    if raises is not None:
        fake.find_active_prospect_by_email = AsyncMock(side_effect=raises)
    else:
        fake.find_active_prospect_by_email = AsyncMock(return_value=existing)
    fake.create_prospect = AsyncMock(return_value=created)

    monkeypatch.setattr(
        "app.services.guest_check_in_service.MembershipPipelineService",
        lambda _db: fake,
    )
    return fake


def _make_prospect(prospect_id=None):
    prospect = MagicMock()
    prospect.id = prospect_id or str(uuid4())
    return prospect


class TestGuestCheckInGating:
    """The event must opt in, and the window must be open."""

    async def test_refuses_when_event_has_not_opted_in(self):
        event = _make_event(allow_guest_check_in=False)
        service = GuestCheckInService(_mock_db())

        attendee, error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
        )

        assert attendee is None
        assert error is not None
        assert "not enabled" in error
        assert created is False

    def test_window_open_during_event(self):
        event = _make_event()
        is_open, reason = GuestCheckInService.check_in_window_state(
            event, datetime.now(timezone.utc)
        )

        assert is_open is True
        assert reason is None

    def test_window_closed_before_it_opens(self):
        """Anonymous callers get no early-arrival grace.

        A member checking in early is identifiable and correctable; a guest is
        neither, so a FLEXIBLE event still refuses before its window opens
        rather than accepting with a notice.
        """
        now = datetime.now(timezone.utc)
        event = _make_event(
            start_datetime=now + timedelta(hours=3),
            end_datetime=now + timedelta(hours=5),
        )

        is_open, reason = GuestCheckInService.check_in_window_state(event, now)

        assert is_open is False
        assert reason is not None
        assert "not opened" in reason

    def test_window_closed_after_event_ends(self):
        now = datetime.now(timezone.utc)
        event = _make_event(
            start_datetime=now - timedelta(hours=5),
            end_datetime=now - timedelta(hours=3),
        )

        is_open, reason = GuestCheckInService.check_in_window_state(event, now)

        assert is_open is False
        assert reason is not None
        assert "closed" in reason

    def test_window_respects_actual_end_time(self):
        """An event ended early closes guest sign-in early too."""
        now = datetime.now(timezone.utc)
        event = _make_event(
            start_datetime=now - timedelta(hours=2),
            end_datetime=now + timedelta(hours=2),
            actual_end_time=now - timedelta(minutes=5),
        )

        is_open, _reason = GuestCheckInService.check_in_window_state(event, now)

        assert is_open is False


class TestGuestAttendanceRecord:
    """Attendance is always recorded, exactly once per person per event."""

    async def test_creates_attendee_record(self):
        event = _make_event()
        mock_db = _mock_db()
        service = GuestCheckInService(mock_db)

        attendee, error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="Dana.Reyes@Example.com",
            phone="555-0100",
            interest_reason="Saw the open house flyer",
        )

        assert error is None
        assert created is False  # prospect creation is off for this event
        assert attendee is not None
        assert attendee.name == "Dana Reyes"
        assert attendee.email == "dana.reyes@example.com"  # normalized
        assert attendee.checked_in is True
        assert attendee.checked_in_at is not None
        assert attendee.source == GuestCheckInService.SOURCE_KIOSK_QR
        assert attendee.event_id == str(event.id)
        assert attendee.organization_id == event.organization_id
        mock_db.commit.assert_awaited()

    async def test_repeat_scan_updates_existing_row(self):
        """A second tap must not create a second attendee."""
        event = _make_event()
        checked_in_at = datetime.now(timezone.utc) - timedelta(minutes=20)
        existing = EventExternalAttendee(
            id=str(uuid4()),
            organization_id=event.organization_id,
            event_id=str(event.id),
            name="Dana Reyes",
            email="dana.reyes@example.com",
            checked_in=True,
            checked_in_at=checked_in_at,
        )
        mock_db = _mock_db(existing_attendee=existing)
        service = GuestCheckInService(mock_db)

        attendee, error, _created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
            phone="555-0100",
        )

        assert error is None
        assert attendee is existing
        assert mock_db.add.call_count == 0
        # The original timestamp stands — they arrived when they arrived.
        assert attendee.checked_in_at == checked_in_at
        # Blank fields still get filled in from the newer submission.
        assert attendee.phone == "555-0100"

    async def test_existing_row_not_checked_in_is_checked_in(self):
        """A guest pre-registered by staff gets checked in, not duplicated."""
        event = _make_event()
        existing = EventExternalAttendee(
            id=str(uuid4()),
            organization_id=event.organization_id,
            event_id=str(event.id),
            name="Dana Reyes",
            email="dana.reyes@example.com",
            checked_in=False,
        )
        mock_db = _mock_db(existing_attendee=existing)
        service = GuestCheckInService(mock_db)

        attendee, error, _created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
        )

        assert error is None
        assert attendee.checked_in is True
        assert attendee.checked_in_at is not None
        assert mock_db.add.call_count == 0

    async def test_staff_entered_details_are_not_overwritten(self):
        event = _make_event()
        existing = EventExternalAttendee(
            id=str(uuid4()),
            organization_id=event.organization_id,
            event_id=str(event.id),
            name="Dana Reyes",
            email="dana.reyes@example.com",
            phone="555-0999",
            organization_name="Ladder 12",
            checked_in=False,
        )
        service = GuestCheckInService(_mock_db(existing_attendee=existing))

        attendee, _error, _created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
            phone="555-0100",
            organization_name="Somewhere Else",
        )

        assert attendee.phone == "555-0999"
        assert attendee.organization_name == "Ladder 12"


class TestGuestProspectCreation:
    """Guests become recruitment leads when the event asks for it."""

    async def test_creates_prospect_when_enabled(self, monkeypatch):
        event = _make_event(guest_check_in_creates_prospect=True)
        prospect = _make_prospect()
        service = GuestCheckInService(_mock_db())
        fake_pipeline = _patch_pipeline(service, monkeypatch, created=prospect)

        attendee, error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
            phone="555-0100",
            interest_reason="Want to help",
        )

        assert error is None
        assert created is True
        assert attendee.prospect_id == prospect.id

        fake_pipeline.create_prospect.assert_awaited_once()
        kwargs = fake_pipeline.create_prospect.await_args.kwargs
        assert kwargs["organization_id"] == event.organization_id
        assert kwargs["data"]["first_name"] == "Dana"
        assert kwargs["data"]["last_name"] == "Reyes"
        assert kwargs["data"]["email"] == "dana.reyes@example.com"
        assert kwargs["data"]["interest_reason"] == "Want to help"
        assert event.title in kwargs["data"]["referral_source"]
        assert kwargs["data"]["metadata_"]["source_event_id"] == str(event.id)

    async def test_no_prospect_without_an_email(self, monkeypatch):
        """There is nothing to follow up on without contact details."""
        event = _make_event(guest_check_in_creates_prospect=True)
        service = GuestCheckInService(_mock_db())
        fake_pipeline = _patch_pipeline(service, monkeypatch)

        attendee, error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
        )

        assert error is None
        assert created is False
        assert attendee.prospect_id is None
        fake_pipeline.create_prospect.assert_not_awaited()

    async def test_no_prospect_when_event_opts_out(self, monkeypatch):
        event = _make_event(guest_check_in_creates_prospect=False)
        service = GuestCheckInService(_mock_db())
        fake_pipeline = _patch_pipeline(service, monkeypatch)

        _attendee, _error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
        )

        assert created is False
        fake_pipeline.find_active_prospect_by_email.assert_not_awaited()
        fake_pipeline.create_prospect.assert_not_awaited()

    async def test_reuses_existing_prospect(self, monkeypatch):
        """Someone already in the pipeline is linked, not re-applied.

        create_prospect's own duplicate path emails the applicant a "we already
        have your application" notice, which is wrong for someone who merely
        attended a second interest meeting — so the lookup happens first.
        """
        event = _make_event(guest_check_in_creates_prospect=True)
        existing = _make_prospect()
        service = GuestCheckInService(_mock_db())
        fake_pipeline = _patch_pipeline(service, monkeypatch, existing=existing)

        attendee, error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
        )

        assert error is None
        assert created is False
        assert attendee.prospect_id == existing.id
        fake_pipeline.create_prospect.assert_not_awaited()

    async def test_pipeline_failure_still_records_attendance(self, monkeypatch):
        """The sign-in is what the guest came to do — it must survive."""
        event = _make_event(guest_check_in_creates_prospect=True)
        service = GuestCheckInService(_mock_db())
        _patch_pipeline(service, monkeypatch, raises=RuntimeError("pipeline down"))

        attendee, error, created = await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
        )

        assert error is None
        assert created is False
        assert attendee is not None
        assert attendee.checked_in is True
        assert attendee.prospect_id is None

    async def test_links_prospect_to_event(self, monkeypatch):
        event = _make_event(guest_check_in_creates_prospect=True)
        prospect = _make_prospect()
        mock_db = _mock_db()
        service = GuestCheckInService(mock_db)
        _patch_pipeline(service, monkeypatch, created=prospect)

        await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
        )

        links = [
            obj
            for obj in mock_db.added
            if obj.__class__.__name__ == "ProspectEventLink"
        ]
        assert len(links) == 1
        assert links[0].prospect_id == prospect.id
        assert links[0].event_id == str(event.id)

    async def test_does_not_duplicate_an_existing_event_link(self, monkeypatch):
        """prospect_event_links carries a unique (prospect, event) index."""
        event = _make_event(guest_check_in_creates_prospect=True)
        prospect = _make_prospect()
        mock_db = _mock_db(existing_link=MagicMock())
        service = GuestCheckInService(mock_db)
        _patch_pipeline(service, monkeypatch, existing=prospect)

        await service.check_in_guest(
            event=event,
            organization_id=event.organization_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes@example.com",
        )

        links = [
            obj
            for obj in mock_db.added
            if obj.__class__.__name__ == "ProspectEventLink"
        ]
        assert links == []


class TestGuestCheckInSchema:
    """Request validation at the API boundary."""

    def test_blank_names_are_rejected(self):
        from pydantic import ValidationError

        from app.schemas.event import GuestCheckInRequest

        with pytest.raises(ValidationError):
            GuestCheckInRequest(first_name="   ", last_name="Reyes")

    def test_names_are_stripped(self):
        from app.schemas.event import GuestCheckInRequest

        payload = GuestCheckInRequest(first_name="  Dana ", last_name=" Reyes ")

        assert payload.first_name == "Dana"
        assert payload.last_name == "Reyes"

    @pytest.mark.parametrize("ctrl", ["\x1d", "\x1c", "\x1f", "\x85", "\x0b"])
    def test_control_character_names_are_rejected(self, ctrl):
        from pydantic import ValidationError

        from app.schemas.event import GuestCheckInRequest

        with pytest.raises(ValidationError):
            GuestCheckInRequest(first_name=ctrl, last_name="Reyes")

    @pytest.mark.parametrize("field", ["first_name", "last_name"])
    def test_names_publish_their_content_constraint(self, field):
        # The rejection above always happened — in the validator. What the
        # published schema said was merely minLength=1, so a generated client
        # (and the contract suite) believed a lone control character was a
        # valid name. This is the assertion that distinguishes the two: the
        # constraint has to be *in the schema*, which is all Schemathesis reads.
        import re

        from app.schemas.event import GuestCheckInRequest

        prop = GuestCheckInRequest.model_json_schema()["properties"][field]

        assert "pattern" in prop, f"{field} does not publish its content rule"
        assert not re.search(prop["pattern"], "\x1d")
        assert re.search(prop["pattern"], "Dana")

    @pytest.mark.parametrize(
        "name", ["José", "Müller", "李", "O'Brien", "J.R.", "Ng", "X"]
    )
    def test_real_names_still_accepted(self, name):
        # The pattern must not be so strict that it rejects accented, CJK or
        # punctuated names — it constrains "has content", not "is ASCII".
        from app.schemas.event import GuestCheckInRequest

        payload = GuestCheckInRequest(first_name=name, last_name="Reyes")

        assert payload.first_name == name

    def test_schema_valid_names_never_reach_the_blank_branch(self):
        # The invariant the fix rests on: every code point the schema pattern
        # admits survives str.strip(), so validation cannot reject data the
        # published schema calls valid. Checked exhaustively rather than by
        # reasoning about which definition of whitespace applies where.
        import re

        from app.schemas.event import NAME_HAS_CONTENT

        pattern = re.compile(NAME_HAS_CONTENT)
        offenders = [
            cp
            for cp in range(0x110000)
            if pattern.fullmatch(chr(cp)) and chr(cp).strip() == ""
        ]

        assert offenders == []

    def test_email_is_optional(self):
        from app.schemas.event import GuestCheckInRequest

        payload = GuestCheckInRequest(first_name="Dana", last_name="Reyes")

        assert payload.email is None

    def test_invalid_email_is_rejected(self):
        from pydantic import ValidationError

        from app.schemas.event import GuestCheckInRequest

        with pytest.raises(ValidationError):
            GuestCheckInRequest(
                first_name="Dana", last_name="Reyes", email="not-an-email"
            )
