"""Finance and fundraising request times reach the model in UTC.

Scheduled-email send times (converted by the endpoint, which refuses a naive
value), check dates, dues due dates, advance returns,
donation dates and fundraising-event dates live in MySQL DATETIME columns, and
the driver formats an aware datetime by its wall clock, dropping the offset: a
value sent as ``18:00-04:00`` was written as 18:00 and read back as 18:00 UTC.
A naive value reached services that compare it with an aware "now" or an aware
stored instant, where the two forms raise ``TypeError``. The schemas convert
on the way in, through ``app.schemas.base.UTCDateTime``; the scheduled-email
endpoint applies ``as_utc`` to the aware value it accepts.

Fiscal-year boundaries and ``date_incurred`` are deliberately not converted:
they are calendar days stored at midnight and read back with ``.date()``, so
converting an offset would move them to another day.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pymysql.converters
import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.email_templates import schedule_email, update_scheduled_email
from app.models.email_template import ScheduledEmailStatus
from app.schemas.email_template import ScheduledEmailCreate, ScheduledEmailUpdate
from app.schemas.finance import (
    AdvanceReturnCreate,
    CheckRequestUpdate,
    DuesScheduleCreate,
    DuesScheduleUpdate,
)
from app.schemas.grant import (
    DonationCreate,
    DonationUpdate,
    FundraisingEventCreate,
    FundraisingEventUpdate,
)

pytestmark = [pytest.mark.unit]

OFFSET = "2026-10-17T18:00:00-04:00"
STORED = "'2026-10-17 22:00:00'"
NAIVE = "2026-10-17T22:00:00"
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)


def _stored(value: datetime | None) -> str:
    """What pymysql actually writes into the DATETIME column."""
    assert value is not None
    return pymysql.converters.escape_item(value, "utf8")


def _aware_and_comparable(value: datetime | None) -> None:
    """A naive input comes out aware, so the service's comparison works."""
    assert value is not None
    assert value.utcoffset() == timedelta(0)
    assert value < NOW
    assert _stored(value) == STORED


def _future(hour_offset: str = "-04:00") -> str:
    """18:00 local, a year ahead, so the endpoint's "in the future" check passes."""
    return f"{datetime.now(timezone.utc).year + 1}-10-17T18:00:00{hour_offset}"


def _db(existing=None):
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=existing))
    )
    return db


USER = SimpleNamespace(id="u-1", organization_id="org-1")


class TestScheduledEmail:
    """The schema keeps a naive value naive so the endpoint can refuse it: a
    stale client sending local wall time is told so rather than scheduled
    hours off. An aware value is converted by the endpoint before storing."""

    BODY = {"template_type": "welcome", "to_emails": ["a@example.com"]}

    async def test_schedule_offset_is_stored_as_the_utc_instant(self):
        db = _db()
        body = ScheduledEmailCreate(**self.BODY, scheduled_at=_future())

        await schedule_email(body=body, db=db, current_user=USER)

        stored = db.add.call_args.args[0].scheduled_at
        year = datetime.now(timezone.utc).year + 1
        assert _stored(stored) == f"'{year}-10-17 22:00:00'"

    async def test_schedule_naive_is_refused(self):
        body = ScheduledEmailCreate(**self.BODY, scheduled_at=_future(""))

        with pytest.raises(HTTPException) as exc:
            await schedule_email(body=body, db=_db(), current_user=USER)

        assert exc.value.status_code == 400
        assert "timezone" in exc.value.detail

    async def test_reschedule_offset_is_stored_as_the_utc_instant(self):
        existing = SimpleNamespace(
            status=ScheduledEmailStatus.PENDING, scheduled_at=None
        )
        body = ScheduledEmailUpdate(scheduled_at=_future())

        await update_scheduled_email(
            scheduled_id="s-1", body=body, db=_db(existing), current_user=USER
        )

        year = datetime.now(timezone.utc).year + 1
        assert _stored(existing.scheduled_at) == f"'{year}-10-17 22:00:00'"

    async def test_reschedule_naive_is_refused(self):
        existing = SimpleNamespace(
            status=ScheduledEmailStatus.PENDING, scheduled_at=None
        )
        body = ScheduledEmailUpdate(scheduled_at=_future(""))

        with pytest.raises(HTTPException) as exc:
            await update_scheduled_email(
                scheduled_id="s-1", body=body, db=_db(existing), current_user=USER
            )

        assert exc.value.status_code == 400
        assert existing.scheduled_at is None


class TestCheckRequestUpdate:
    def test_offset_is_stored_as_the_utc_instant(self):
        assert _stored(CheckRequestUpdate(check_date=OFFSET).check_date) == STORED

    def test_naive_is_read_as_utc(self):
        _aware_and_comparable(CheckRequestUpdate(check_date=NAIVE).check_date)

    def test_explicit_null_survives(self):
        data = CheckRequestUpdate(check_date=None)

        assert "check_date" in data.model_dump(exclude_unset=True)


class TestDuesSchedule:
    BODY = {"name": "Annual dues", "amount": "50.00", "frequency": "annual"}

    def test_create_offset_is_stored_as_the_utc_instant(self):
        # The dues dialog sends local midnight as a UTC instant; an offset
        # form of the same instant must store the same value.
        data = DuesScheduleCreate(**self.BODY, due_date="2026-11-01T00:00:00-04:00")

        assert _stored(data.due_date) == "'2026-11-01 04:00:00'"

    def test_create_naive_is_read_as_utc(self):
        # Generating dues compares due_date with an aware now().
        _aware_and_comparable(DuesScheduleCreate(**self.BODY, due_date=NAIVE).due_date)

    def test_update_offset_is_stored_as_the_utc_instant(self):
        assert _stored(DuesScheduleUpdate(due_date=OFFSET).due_date) == STORED

    def test_update_naive_is_read_as_utc(self):
        _aware_and_comparable(DuesScheduleUpdate(due_date=NAIVE).due_date)


class TestAdvanceReturnCreate:
    def test_offset_is_stored_as_the_utc_instant(self):
        data = AdvanceReturnCreate(amount="10.00", returned_at=OFFSET)

        assert _stored(data.returned_at) == STORED

    def test_naive_is_read_as_utc(self):
        # The service compares returned_at with now() and the issued check date.
        _aware_and_comparable(
            AdvanceReturnCreate(amount="10.00", returned_at=NAIVE).returned_at
        )

    def test_omitted_stays_none_for_the_service_default(self):
        assert AdvanceReturnCreate(amount="10.00").returned_at is None


class TestDonation:
    BODY = {"amount": "25.00", "payment_method": "cash"}

    def test_create_offset_is_stored_as_the_utc_instant(self):
        data = DonationCreate(**self.BODY, donation_date=OFFSET)

        assert _stored(data.donation_date) == STORED

    def test_create_naive_is_read_as_utc(self):
        _aware_and_comparable(
            DonationCreate(**self.BODY, donation_date=NAIVE).donation_date
        )

    def test_update_offset_is_stored_as_the_utc_instant(self):
        assert _stored(DonationUpdate(donation_date=OFFSET).donation_date) == STORED


class TestFundraisingEvent:
    BODY = {"name": "Pancake breakfast", "event_type": "dinner"}

    def test_create_offset_is_stored_as_the_utc_instant(self):
        data = FundraisingEventCreate(**self.BODY, event_date=OFFSET)

        assert _stored(data.event_date) == STORED

    def test_create_camel_alias_is_converted_too(self):
        data = FundraisingEventCreate(**self.BODY, eventDate=OFFSET)

        assert _stored(data.event_date) == STORED

    def test_update_offset_is_stored_as_the_utc_instant(self):
        assert _stored(FundraisingEventUpdate(event_date=OFFSET).event_date) == STORED

    def test_update_naive_is_read_as_utc(self):
        _aware_and_comparable(FundraisingEventUpdate(event_date=NAIVE).event_date)
