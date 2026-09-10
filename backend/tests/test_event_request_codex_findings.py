"""Regressions for the five findings Codex raised on PR #2447.

Each one is a case the original change got wrong, kept here so the specific
mistake cannot come back:

* the backfill selected a department whose request form is switched off;
* a derived event end reached the calendar but not the staffing sheet;
* the downgrade would have deleted opt-ins it never set;
* a mixed naive/aware date window turned a 422 into a 500;
* an unparseable audience size spent the department's daily allowance.
"""

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.models.event_request import EventRequest
from app.models.forms import IntegrationType
from app.schemas.event_request import EventRequestCreate, EventRequestSchedule
from app.services.event_request_service import parse_audience_size
from app.services.forms_service import FormsService

ORG_ID = "00000000-0000-0000-0000-000000000001"
SUBMISSION_ID = "00000000-0000-0000-0000-0000000000cc"

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260909_1526_d19b2c2ae9b9_enable_public_event_requests_where_a_.py"
)


# ============================================
# P1 — the backfill must not open intake a department switched off
# ============================================


class TestBackfillSelection:
    """`_process_integrations` skips a form whose same-type rows are all
    inactive, so such a department is not taking requests and the backfill must
    not say it is. Asserted against the SQL because the migration's query is
    the whole of its behaviour."""

    @staticmethod
    def _sql() -> str:
        text = MIGRATION.read_text()
        match = re.search(
            r"_ORG_IDS_WITH_PUBLISHED_REQUEST_FORM = sa\.text\(\s*\"\"\"(.*?)\"\"\"",
            text,
            re.S,
        )
        assert match, "could not find the backfill query"
        return " ".join(match.group(1).split())

    def test_an_active_row_qualifies(self):
        assert "fi.is_active = 1" in self._sql()

    def test_the_marker_qualifies_only_with_no_rows_of_that_type(self):
        """The bug: a bare `OR f.integration_type = 'event_request'` selected a
        department whose only integration row had been deactivated."""
        sql = self._sql()
        assert "NOT EXISTS" in sql
        assert re.search(
            r"f\.integration_type = 'event_request'\s+AND NOT EXISTS", sql
        ), sql

    def test_only_published_public_forms_are_considered(self):
        sql = self._sql()
        assert "f.status = 'published'" in sql
        assert "f.is_public = 1" in sql


# ============================================
# P1 — the downgrade must not delete opt-ins it never set
# ============================================


class TestDowngradeIsIrreversible:
    """Nothing recorded which organizations already carried `true`, so removing
    the key wherever it is true is a strictly larger deletion than the upgrade
    — and the reverted code still reads the flag on the JSON endpoint, so that
    deletion would close a deliberately-enabled intake."""

    def test_the_downgrade_writes_nothing(self):
        body = MIGRATION.read_text().split("def downgrade()")[1]
        assert "UPDATE organizations" not in body
        assert "_enable_flag" not in body

    def test_the_irreversibility_is_stated_in_the_docstring(self):
        docstring = MIGRATION.read_text().split('"""')[1]
        assert "Irreversible" in docstring


# ============================================
# P2 — one authority for the confirmed end time
# ============================================


@pytest.mark.asyncio
async def test_a_derived_end_time_is_stored_on_the_request():
    """`open_staffing_shift` and `sync_staffing_shift_date` fall back to
    `start + 2 hours` when the request carries no end, so a calendar entry given
    the department's 60-minute default while the request stayed empty put the
    signup sheet on a different clock for the same event."""
    from app.api.v1.endpoints.event_requests import schedule_request
    from app.models.event_request import EventRequestStatus

    start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
    org = SimpleNamespace(
        id=ORG_ID, name="Oakville", active=True, timezone="UTC", settings={"events": {}}
    )
    event_request = SimpleNamespace(
        id="req-1",
        organization_id=ORG_ID,
        status=EventRequestStatus.IN_PROGRESS,
        outreach_type="station_tour",
        contact_name="Dana Reyes",
        organization_name=None,
        description="Station tour.",
        venue_address=None,
        event_id=None,
        event_date=None,
        event_end_date=None,
        event_location_id=None,
        staffing_shift_id=None,
        activity_log=[],
    )
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [
        SimpleNamespace(scalar_one_or_none=lambda: event_request),
        SimpleNamespace(scalar_one_or_none=lambda: org),
        SimpleNamespace(scalar_one_or_none=lambda: org),
    ]
    db.scalar.return_value = None

    class _Svc:
        def __init__(self, _db):
            self.create_event = AsyncMock(return_value=SimpleNamespace(id="ev-1"))
            self.update_event = AsyncMock()

    with (
        patch("app.services.event_service.EventService", _Svc),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        await schedule_request(
            request_id="req-1",
            data=EventRequestSchedule(event_date=start, create_calendar_event=True),
            db=db,
            current_user=SimpleNamespace(id="user-1", organization_id=ORG_ID),
        )

    # The department's default is 60 minutes, and the request now carries it —
    # so the staffing sheet's 2-hour fallback is never reached.
    assert event_request.event_end_date == start + timedelta(minutes=60)


# ============================================
# P2 — a mixed naive/aware window is a 422, not a 500
# ============================================


class TestMixedAwarenessDates:
    """Pydantic v2 converts only ValueError and AssertionError into validation
    errors, so a TypeError from comparing a naive against an aware datetime
    escapes the validator as a 500."""

    def _payload(self, **overrides):
        data = {
            "contact_name": "Dana Reyes",
            "contact_email": "dana@example.org",
            "outreach_type": "station_tour",
            "description": "Station tour for a scout troop of about twenty.",
        }
        data.update(overrides)
        return data

    def test_a_naive_start_against_an_aware_end_does_not_raise_typeerror(self):
        model = EventRequestCreate(
            **self._payload(
                preferred_date_start="2026-10-01T10:00:00",
                preferred_date_end="2026-10-02T10:00:00Z",
            )
        )
        assert model.preferred_date_end is not None

    def test_a_reversed_mixed_window_is_still_a_validation_error(self):
        with pytest.raises(ValidationError):
            EventRequestCreate(
                **self._payload(
                    preferred_date_start="2026-10-05T10:00:00",
                    preferred_date_end="2026-10-02T10:00:00Z",
                )
            )

    def test_the_schedule_schema_normalizes_too(self):
        """Same one-line shape, and it predates this change."""
        model = EventRequestSchedule(
            event_date="2026-10-01T10:00:00",
            event_end_date="2026-10-01T12:00:00Z",
        )
        assert model.event_end_date is not None

        with pytest.raises(ValidationError):
            EventRequestSchedule(
                event_date="2026-10-01T14:00:00",
                event_end_date="2026-10-01T12:00:00Z",
            )


# ============================================
# P1 — an unparseable answer costs the field, not the day's allowance
# ============================================


class TestAudienceSize:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("25", 25),
            (" 25 ", 25),
            ("25.0", 25),
            (30, 30),
            ("twenty", None),
            ("about twenty", None),
            ("", None),
            (None, None),
            ("0", None),
            ("-5", None),
            ("999999", 10000),
        ],
    )
    def test_parse(self, raw, expected):
        assert parse_audience_size(raw) == expected


def _service(org):
    db = AsyncMock()
    db.add = MagicMock()
    db.scalar.side_effect = [org, None]
    db.execute.return_value = SimpleNamespace(first=lambda: ("Sam", "Ortiz"))
    return FormsService(db), db


@pytest.mark.asyncio
async def test_an_unparseable_audience_size_neither_fails_nor_spends_the_quota():
    """The generated form asks for audience size as a TEXT field, so a public
    answer of "twenty" is ordinary. `int()` on it used to raise below the
    daily-cap INCR: the allowance was spent and the request was lost, so one
    repeated bad answer could exhaust a department's whole day."""
    org = SimpleNamespace(
        id=ORG_ID,
        name="Oakville",
        active=True,
        timezone="UTC",
        settings={"events": {"request_pipeline": {"accept_public_requests": True}}},
    )
    service, db = _service(org)
    submission = SimpleNamespace(
        id=SUBMISSION_ID,
        organization_id=ORG_ID,
        data={
            "f_name": "Dana Reyes",
            "f_email": "dana@example.org",
            "f_type": "station_tour",
            "f_desc": "Station tour for a scout troop.",
            "f_size": "about twenty",
        },
        ip_address="203.0.113.9",
    )
    integration = SimpleNamespace(
        integration_type=IntegrationType.EVENT_REQUEST,
        is_active=True,
        field_mappings={
            "f_name": "contact_name",
            "f_email": "contact_email",
            "f_type": "outreach_type",
            "f_desc": "description",
            "f_size": "audience_size",
        },
    )

    with (
        patch(
            "app.services.event_request_service.send_request_notification", AsyncMock()
        ),
        patch(
            "app.services.forms_service.daily_cap_exceeded",
            AsyncMock(return_value=False),
        ) as cap,
    ):
        result = await service._process_event_request(
            submission, integration=integration, form=None, is_public=True
        )

    assert result["success"] is True
    added = [
        c.args[0] for c in db.add.call_args_list if isinstance(c.args[0], EventRequest)
    ]
    assert len(added) == 1
    assert added[0].audience_size is None
    # The allowance was spent exactly once, on a submission that was stored.
    assert cap.await_count == 1
