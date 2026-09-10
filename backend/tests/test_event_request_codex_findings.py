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
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.event_request import EventRequest, EventRequestActivity
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


# ============================================
# Round 2 — findings on the fixes themselves
# ============================================


@pytest.mark.asyncio
async def test_a_signed_in_member_is_not_subject_to_the_public_gates():
    """`/f/<slug>` also serves forms that require authentication.

    `submit_public_form` hardcoded `is_public=True`, so a signed-in member
    submitting an authentication-required request form was blocked by
    `accept_public_requests` and spent the anonymous quota — the exact internal
    submission the flag exists to exempt.
    """
    service = FormsService(AsyncMock())
    service._create_public_submission = AsyncMock(
        return_value=(SimpleNamespace(id="sub-1"), SimpleNamespace(id="form-1"), None)
    )
    service._process_integrations = AsyncMock()

    await service.submit_public_form(
        slug="abcd1234",
        data={},
        submitted_by="user-1",
    )

    assert service._process_integrations.await_args.kwargs["is_public"] is False


@pytest.mark.asyncio
async def test_an_anonymous_submission_is_still_public():
    service = FormsService(AsyncMock())
    service._create_public_submission = AsyncMock(
        return_value=(SimpleNamespace(id="sub-1"), SimpleNamespace(id="form-1"), None)
    )
    service._process_integrations = AsyncMock()

    await service.submit_public_form(slug="abcd1234", data={}, submitted_by=None)

    assert service._process_integrations.await_args.kwargs["is_public"] is True


class TestResolveConfirmedEnd:
    """One answer for four surfaces (calendar, signup sheet, emails, status)."""

    START = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)

    def _org(self, minutes=None):
        defaults = {"default_duration_minutes": minutes} if minutes else {}
        return SimpleNamespace(settings={"events": {"defaults": defaults}})

    def _event(self, hours=3, cancelled=False):
        return SimpleNamespace(
            start_datetime=self.START - timedelta(days=14),
            end_datetime=self.START - timedelta(days=14) + timedelta(hours=hours),
            is_cancelled=cancelled,
        )

    def test_an_explicit_end_wins(self):
        from app.services.event_request_service import resolve_confirmed_end

        explicit = self.START + timedelta(hours=5)
        assert (
            resolve_confirmed_end(self.START, explicit, self._event(), self._org())
            == explicit
        )

    def test_an_existing_entry_keeps_its_length(self):
        from app.services.event_request_service import resolve_confirmed_end

        assert resolve_confirmed_end(
            self.START, None, self._event(hours=3), self._org()
        ) == self.START + timedelta(hours=3)

    def test_a_cancelled_entry_does_not_lend_its_length(self):
        from app.services.event_request_service import resolve_confirmed_end

        assert resolve_confirmed_end(
            self.START, None, self._event(hours=3, cancelled=True), self._org()
        ) == self.START + timedelta(minutes=60)

    def test_no_entry_takes_the_department_default(self):
        from app.services.event_request_service import resolve_confirmed_end

        assert resolve_confirmed_end(
            self.START, None, None, self._org(minutes=90)
        ) == self.START + timedelta(minutes=90)

    def test_a_degenerate_stored_window_falls_back(self):
        from app.services.event_request_service import resolve_confirmed_end

        assert resolve_confirmed_end(
            self.START, None, self._event(hours=0), self._org()
        ) == self.START + timedelta(minutes=60)


@pytest.mark.asyncio
async def test_postponing_to_a_new_date_stores_a_resolved_end():
    """The staffing helper assumes two hours and the calendar helper preserves
    the entry's own span, so a postponement that named no end left them
    disagreeing about the same event."""
    from app.api.v1.endpoints.event_requests import postpone_request
    from app.models.event_request import EventRequestStatus
    from app.schemas.event_request import EventRequestPostpone

    start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
    org = SimpleNamespace(
        id=ORG_ID, name="Oakville", active=True, timezone="UTC", settings={"events": {}}
    )
    event_request = SimpleNamespace(
        id="req-1",
        organization_id=ORG_ID,
        status=EventRequestStatus.SCHEDULED,
        event_id="ev-1",
        event_date=None,
        event_end_date=None,
        staffing_shift_id=None,
    )
    linked = SimpleNamespace(
        id="ev-1",
        organization_id=ORG_ID,
        is_cancelled=False,
        start_datetime=start - timedelta(days=7),
        end_datetime=start - timedelta(days=7) + timedelta(hours=3),
    )
    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [
        SimpleNamespace(scalar_one_or_none=lambda: event_request),
        SimpleNamespace(scalar_one_or_none=lambda: org),
    ]
    db.scalar.return_value = linked

    with (
        patch(
            "app.api.v1.endpoints.event_requests.sync_staffing_shift_date", AsyncMock()
        ),
        patch(
            "app.api.v1.endpoints.event_requests.sync_calendar_event_date",
            AsyncMock(return_value=None),
        ),
        patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ),
    ):
        await postpone_request(
            request_id="req-1",
            data=EventRequestPostpone(new_event_date=start),
            db=db,
            current_user=SimpleNamespace(id="user-1", organization_id=ORG_ID),
        )

    # The linked entry's own 3-hour length, not the staffing helper's 2 hours.
    assert event_request.event_end_date == start + timedelta(hours=3)


class TestPreferenceBackfill:
    """The write-side normalizer only settles future writes; rows stored before
    the upgrade keep the off-list values that motivated it (pitfall #20)."""

    BACKFILL = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260910_0223_0533644945cd_settle_off_list_event_request_.py"
    )

    def test_the_backfill_exists_and_is_guarded_on_the_table(self):
        text = self.BACKFILL.read_text()
        # event_requests is create_all-only, so an unguarded reflect kills the
        # whole upgrade on a fresh database (pitfall #26).
        assert '_has_table("event_requests")' in text

    def test_it_covers_the_three_fixed_vocabularies(self):
        from app.services.event_request_service import (
            DATE_FLEXIBILITIES,
            TIMES_OF_DAY,
            VENUE_PREFERENCES,
        )

        text = self.BACKFILL.read_text()
        for column in (
            "date_flexibility",
            "venue_preference",
            "preferred_time_of_day",
        ):
            assert column in text
        # The migration's vocabularies must not drift from the service's.
        for value in (*DATE_FLEXIBILITIES, *VENUE_PREFERENCES, *TIMES_OF_DAY):
            assert f'"{value}"' in text, value

    def test_it_leaves_outreach_type_alone(self):
        """Per-organization configurable: an off-list value may be a type the
        department retired, and rewriting it would destroy that."""
        assert "outreach_type" not in self.BACKFILL.read_text().split('"""')[2]

    def test_nulls_are_preserved(self):
        assert "IS NOT NULL" in self.BACKFILL.read_text()


# ============================================
# Round 3 — findings on the round-2 fixes
# ============================================


@pytest.mark.asyncio
async def test_the_acknowledgement_waits_for_the_commit():
    """The request is only flushed while the integration runs; the commit lands
    in `_process_integrations` afterwards, and `submit_public_form` rolls back
    if it fails. Sending during the integration left a member of the public
    holding "we have received your request" for a row that no longer exists."""
    order: list = []

    service = FormsService(AsyncMock())
    service.db.commit = AsyncMock(side_effect=lambda: order.append("commit"))
    service._auto_advance_pipeline_step = AsyncMock()

    async def _fake_integration(*_args, **_kwargs):
        service._defer_until_committed(
            lambda: _send()  # noqa: E731 - deferred on purpose
        )
        return {"success": True}

    async def _send():
        order.append("email")

    service._process_event_request = AsyncMock(side_effect=_fake_integration)

    submission = SimpleNamespace(integration_processed=False, integration_result=None)
    form = SimpleNamespace(
        integration_type=IntegrationType.EVENT_REQUEST.value, integrations=[]
    )
    await service._process_integrations(submission, form)

    assert order == ["commit", "email"]


@pytest.mark.asyncio
async def test_a_failed_deferred_send_does_not_fail_the_intake():
    """By drain time the submission is durable — a bounced email is a log line,
    not a reason to report the whole intake as failed."""
    service = FormsService(AsyncMock())

    async def _boom():
        raise RuntimeError("smtp down")

    service._defer_until_committed(_boom)
    await service._run_post_commit()

    assert service._post_commit == []


class TestOutreachTypesAreReadDefensively:
    """`update_event_settings` dumps with `exclude_unset`, so an explicit
    `outreach_event_types: null` in a PATCH body is written through as `None` —
    and `settings.get(key, defaults)` hands that back, because the key exists.
    Five call sites iterate the result, two of them on public surfaces."""

    def _org(self, stored):
        return SimpleNamespace(
            id=ORG_ID, settings={"events": {"outreach_event_types": stored}}
        )

    def test_an_explicit_null_falls_back_to_the_defaults(self):
        from app.services.event_request_service import get_outreach_types

        types = get_outreach_types(self._org(None))
        assert {t["value"] for t in types} >= {"station_tour", "other"}

    @pytest.mark.parametrize("stored", ["a string", 42, {}])
    def test_a_non_list_falls_back_to_the_defaults(self, stored):
        from app.services.event_request_service import get_outreach_types

        assert get_outreach_types(self._org(stored))

    def test_malformed_entries_are_dropped_not_returned(self):
        from app.services.event_request_service import get_outreach_types

        types = get_outreach_types(
            self._org(
                [{"value": "smoke_trailer", "label": "Smoke Trailer"}, "junk", {}]
            )
        )
        assert [t["value"] for t in types] == ["smoke_trailer"]

    def test_normalizing_a_request_survives_a_null_setting(self):
        """The comprehension that reads this used to raise TypeError, which is
        a 500 on the JSON endpoint and a failed integration on the forms path."""
        from app.services.event_request_service import normalize_request_preferences

        settled = normalize_request_preferences(
            self._org(None),
            {
                "outreach_type": "station_tour",
                "date_flexibility": "flexible",
                "venue_preference": "either",
                "preferred_time_of_day": "morning",
                "preferred_date_start": None,
            },
        )
        assert settled["outreach_type"] == "station_tour"


class TestBackfillNormalizesRatherThanReplaces:
    """The runtime normalizer applies `strip().lower()`. A plain equality test
    in the migration would rewrite a recoverable `" morning"` to the fallback,
    and — under these columns' case-insensitive collation — leave `"Morning"`
    stored with its capital."""

    BACKFILL = TestPreferenceBackfill.BACKFILL

    def test_it_trims_and_lowercases_before_matching(self):
        sql = self.BACKFILL.read_text()
        assert "LOWER(TRIM(" in sql

    def test_the_fallback_is_only_for_unrecognised_values(self):
        sql = self.BACKFILL.read_text()
        assert "CASE" in sql
        assert "ELSE :fallback" in sql


class TestBackfillExcludesAuthenticatedOnlyForms:
    """A backfill justified as "preserve current behaviour" must not widen a
    public surface.

    `api/public/forms.py` refuses an anonymous submission when
    `require_authentication or not allow_multiple_submissions`. For such a form
    the department never took an anonymous request — and once `is_public` means
    "anonymous", its submissions are exempt from `accept_public_requests`
    outright. Turning the flag on therefore preserves nothing for them; it does
    one thing only, which is to open the unauthenticated JSON endpoint.
    """

    SQL = TestBackfillSelection._sql

    def test_it_requires_an_anonymous_eligible_form(self):
        sql = TestBackfillSelection._sql()
        assert "f.require_authentication = 0" in sql
        assert "f.allow_multiple_submissions = 1" in sql

    def test_a_null_require_authentication_still_qualifies(self):
        """NULL is falsy in Python, so the endpoint does not require auth —
        the SQL has to say the same thing rather than dropping the row."""
        assert "f.require_authentication IS NULL" in TestBackfillSelection._sql()


# ============================================
# Round 4 — findings on the round-3 fixes
# ============================================


class TestMappedTextIsClampedToTheColumns:
    """The generated form leaves its text fields at `MAX_TEXT_LENGTH` (5000)
    while the columns are much narrower, so an over-long value was a DataError
    at flush — after the daily allowance had been spent."""

    def test_each_field_is_trimmed_to_its_column_width(self):
        from app.services.event_request_service import (
            TEXT_FIELD_LIMITS,
            clamp_text_fields,
        )

        oversized = {field: "x" * 6000 for field in TEXT_FIELD_LIMITS}
        clamped = clamp_text_fields(oversized)
        for field, limit in TEXT_FIELD_LIMITS.items():
            assert len(clamped[field]) == limit, field

    def test_values_within_the_limit_are_untouched(self):
        from app.services.event_request_service import clamp_text_fields

        assert clamp_text_fields({"contact_name": "Dana Reyes"})["contact_name"] == (
            "Dana Reyes"
        )

    def test_non_strings_and_absent_keys_are_left_alone(self):
        from app.services.event_request_service import clamp_text_fields

        assert clamp_text_fields({"contact_phone": None}) == {"contact_phone": None}
        assert clamp_text_fields({}) == {}

    @pytest.mark.asyncio
    async def test_an_overlong_name_does_not_spend_the_quota_and_still_stores(self):
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
                "f_name": "D" * 400,
                "f_email": "dana@example.org",
                "f_type": "station_tour",
                "f_desc": "Station tour for a scout troop.",
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
            },
        )

        with (
            patch(
                "app.services.event_request_service.send_request_notification",
                AsyncMock(),
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
            c.args[0]
            for c in db.add.call_args_list
            if isinstance(c.args[0], EventRequest)
        ]
        assert len(added[0].contact_name) == 255
        assert cap.await_count == 1


class TestNormalizedDatesAreAssignedNotJustCompared:
    """Normalising only the comparison left a naive value on the model, so the
    `TypeError` moved one layer down into `EventCreate.validate_dates` — still
    an uncaught 500, just from a different validator."""

    def test_the_schedule_schema_stores_aware_values(self):
        model = EventRequestSchedule(
            event_date="2026-10-01T10:00:00",
            event_end_date="2026-10-01T12:00:00Z",
        )
        assert model.event_date.tzinfo is not None
        assert model.event_end_date.tzinfo is not None
        # The comparison EventCreate makes must now be safe.
        assert model.event_end_date > model.event_date

    def test_the_intake_schema_stores_aware_values(self):
        model = EventRequestCreate(
            contact_name="Dana Reyes",
            contact_email="dana@example.org",
            outreach_type="station_tour",
            description="Station tour for a scout troop of about twenty.",
            preferred_date_start="2026-10-01T10:00:00",
            preferred_date_end="2026-10-02T10:00:00Z",
        )
        assert model.preferred_date_start.tzinfo is not None
        assert model.preferred_date_end.tzinfo is not None


class TestRequesterCancellationAfterTheEventStarted:
    """This path is reached with a status token and no session, and
    `cancel_event` refuses only an attendance-finalized event — so an outreach
    event that had already happened was still cancellable from a link."""

    @staticmethod
    async def _cancel(started: bool):
        from app.api.v1.endpoints.event_requests import public_cancel_request
        from app.models.event_request import EventRequestStatus
        from app.schemas.event_request import EventRequestPublicCancel

        now = datetime.now(timezone.utc)
        event_request = SimpleNamespace(
            id="req-1",
            organization_id=ORG_ID,
            status=EventRequestStatus.SCHEDULED,
            event_id="ev-1",
            staffing_shift_id=None,
        )
        org = SimpleNamespace(id=ORG_ID, name="Oakville", settings={"events": {}})
        linked = SimpleNamespace(
            id="ev-1",
            organization_id=ORG_ID,
            is_cancelled=False,
            start_datetime=(
                now - timedelta(hours=2) if started else now + timedelta(days=7)
            ),
        )
        db = AsyncMock()
        db.add = MagicMock()
        db.execute.side_effect = [
            SimpleNamespace(scalar_one_or_none=lambda: event_request),
            SimpleNamespace(scalar_one_or_none=lambda: org),
        ]
        db.scalar.return_value = linked
        cancelled = AsyncMock()

        with (
            patch(
                "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
                AsyncMock(return_value=(True, 1, 10)),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.sync_staffing_shift_cancelled",
                AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.sync_calendar_event_cancelled",
                cancelled,
            ),
            patch(
                "app.api.v1.endpoints.event_requests._send_request_notification",
                AsyncMock(),
            ),
        ):
            await public_cancel_request(
                token="a-status-token",
                data=EventRequestPublicCancel(reason="School closed"),
                request=SimpleNamespace(
                    headers={},
                    client=SimpleNamespace(host="203.0.113.4"),
                    state=SimpleNamespace(),
                ),
                db=db,
            )
        return event_request, db, cancelled

    @pytest.mark.asyncio
    async def test_a_future_event_is_still_stood_down(self):
        _, _, cancelled = await self._cancel(started=False)
        cancelled.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_an_event_that_already_started_is_left_alone(self):
        event_request, db, cancelled = await self._cancel(started=True)
        cancelled.assert_not_awaited()
        # The withdrawal is still recorded, and so is the decision not to touch
        # the calendar — an officer needs to see both.
        actions = [
            c.args[0].action
            for c in db.add.call_args_list
            if isinstance(c.args[0], EventRequestActivity)
        ]
        assert "cancelled_by_requester" in actions
        assert "calendar_event_kept" in actions


class TestDailyLimitIsReadDefensively:
    """`RequestPipelineUpdate.public_daily_limit` is `Optional[int]` and the
    settings writer persists an explicit null, so `pipeline.get(key, 50)` hands
    back `None` and `int(None)` raised inside the cap check — a 500 on the JSON
    endpoint, and on the forms path a submission that looks accepted while no
    request is created."""

    @pytest.mark.parametrize(
        ("stored", "expected"),
        [
            ({"public_daily_limit": None}, 50),
            ({"public_daily_limit": "lots"}, 50),
            ({"public_daily_limit": 0}, 50),
            ({"public_daily_limit": -3}, 50),
            ({}, 50),
            ({"public_daily_limit": 7}, 7),
            ({"public_daily_limit": "7"}, 7),
        ],
    )
    def test_it_falls_back_to_the_shipped_default(self, stored, expected):
        from app.services.event_request_service import public_daily_limit

        assert public_daily_limit(stored) == expected

    @pytest.mark.asyncio
    async def test_a_null_limit_does_not_fail_a_form_submission(self):
        org = SimpleNamespace(
            id=ORG_ID,
            name="Oakville",
            active=True,
            timezone="UTC",
            settings={
                "events": {
                    "request_pipeline": {
                        "accept_public_requests": True,
                        "public_daily_limit": None,
                    }
                }
            },
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
            },
        )

        with (
            patch(
                "app.services.event_request_service.send_request_notification",
                AsyncMock(),
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
        assert cap.await_args.args == (f"pub_event_request:{ORG_ID}", 50)


class TestPostponeWindowIsValidated:
    """`EventRequestSchedule` refuses a reversed window; the postpone path,
    which also sets a confirmed date, did not.

    Left unvalidated, `resolve_confirmed_end` returns an explicit end
    unchanged, the request stores the reversed interval,
    `sync_staffing_shift_date` moves the sheet to a zero-or-negative window,
    and `sync_calendar_event_date` swallows the calendar service's rejection by
    design — so the endpoint reports success while three surfaces disagree.
    """

    def test_an_ordered_window_is_accepted_and_normalised(self):
        from app.schemas.event_request import EventRequestPostpone

        model = EventRequestPostpone(
            new_event_date="2026-10-01T10:00:00",
            new_event_end_date="2026-10-01T12:00:00Z",
        )
        assert model.new_event_date.tzinfo is not None
        assert model.new_event_end_date > model.new_event_date

    @pytest.mark.parametrize(
        "end",
        ["2026-10-01T09:00:00Z", "2026-10-01T10:00:00"],
        ids=["before", "equal"],
    )
    def test_a_reversed_or_zero_length_window_is_refused(self, end):
        from app.schemas.event_request import EventRequestPostpone

        with pytest.raises(ValidationError):
            EventRequestPostpone(
                new_event_date="2026-10-01T10:00:00", new_event_end_date=end
            )

    def test_an_end_with_no_start_is_refused_rather_than_ignored(self):
        """`postpone_request` only reads the end when a new date is given, so
        accepting it silently would discard what the caller asked for."""
        from app.schemas.event_request import EventRequestPostpone

        with pytest.raises(ValidationError):
            EventRequestPostpone(new_event_end_date="2026-10-01T10:00:00")

    def test_postponing_to_a_date_tbd_is_still_allowed(self):
        from app.schemas.event_request import EventRequestPostpone

        assert EventRequestPostpone(reason="TBD").new_event_date is None


EVENT_UUID = "00000000-0000-0000-0000-0000000000ee"
REQUEST_UUID = "00000000-0000-0000-0000-0000000000ff"
USER_UUID = "00000000-0000-0000-0000-0000000000a1"
SHIFT_UUID = "00000000-0000-0000-0000-0000000000b2"


class TestCalendarRefusalsReachTheCoordinator:
    """`EventService.update_event` raises `ValueError` for a room
    double-booking and for a finalized event. Swallowing those as a log line let
    a postponement commit the new date and move the signup sheet while the
    calendar stayed put — three surfaces disagreeing behind a 200."""

    @staticmethod
    def _request_and_db(linked):
        from app.models.event_request import EventRequestStatus

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        event_request = SimpleNamespace(
            id="req-1",
            organization_id=ORG_ID,
            status=EventRequestStatus.SCHEDULED,
            event_id="ev-1",
            event_date=None,
            event_end_date=None,
            staffing_shift_id=None,
        )
        org = SimpleNamespace(
            id=ORG_ID, name="Oakville", timezone="UTC", settings={"events": {}}
        )
        db = AsyncMock()
        db.add = MagicMock()
        db.execute.side_effect = [
            SimpleNamespace(scalar_one_or_none=lambda: event_request),
            SimpleNamespace(scalar_one_or_none=lambda: org),
        ]
        db.scalar.return_value = linked
        return event_request, db, start

    @pytest.mark.asyncio
    async def test_a_room_conflict_returns_a_reason(self):
        from app.services.event_request_service import sync_calendar_event_date

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        linked = SimpleNamespace(
            id=EVENT_UUID,
            organization_id=ORG_ID,
            is_cancelled=False,
            start_datetime=start - timedelta(days=7),
            end_datetime=start - timedelta(days=7) + timedelta(hours=2),
        )
        request = SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            event_id=EVENT_UUID,
            event_date=start,
            event_end_date=start + timedelta(hours=2),
        )
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = linked

        class _Conflicting:
            def __init__(self, _db):
                self.update_event = AsyncMock(
                    side_effect=ValueError("Location is already booked")
                )

        with patch("app.services.event_service.EventService", _Conflicting):
            reason = await sync_calendar_event_date(db, request, USER_UUID)

        assert reason == "Location is already booked"
        # No activity row claims a move that did not happen.
        assert db.add.call_count == 0

    @pytest.mark.asyncio
    async def test_postponing_into_a_conflict_is_refused_with_409(self):
        from app.api.v1.endpoints.event_requests import postpone_request
        from app.schemas.event_request import EventRequestPostpone

        now = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        linked = SimpleNamespace(
            id=EVENT_UUID,
            organization_id=ORG_ID,
            is_cancelled=False,
            start_datetime=now - timedelta(days=7),
            end_datetime=now - timedelta(days=7) + timedelta(hours=2),
        )
        event_request, db, start = self._request_and_db(linked)

        with (
            patch(
                "app.api.v1.endpoints.event_requests.sync_calendar_event_date",
                AsyncMock(return_value="Location is already booked"),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.sync_staffing_shift_date",
                AsyncMock(),
            ) as shift,
            patch(
                "app.api.v1.endpoints.event_requests._send_request_notification",
                AsyncMock(),
            ),
            pytest.raises(HTTPException) as exc,
        ):
            await postpone_request(
                request_id="req-1",
                data=EventRequestPostpone(new_event_date=start),
                db=db,
                current_user=SimpleNamespace(id="user-1", organization_id=ORG_ID),
            )

        assert exc.value.status_code == 409
        # Nothing was committed, and the signup sheet was never moved.
        db.commit.assert_not_awaited()
        shift.assert_not_awaited()


class TestAnEmptyOutreachTypeListIsPreserved:
    """An explicitly empty list is a configuration, not an absence. Falling back
    to the defaults made `/types/labels`, intake normalization and the form
    generator behave as though five types were configured while the settings
    screen showed none."""

    def _org(self, stored):
        return SimpleNamespace(
            id=ORG_ID, settings={"events": {"outreach_event_types": stored}}
        )

    def test_an_explicit_empty_list_stays_empty(self):
        from app.services.event_request_service import get_outreach_types

        assert get_outreach_types(self._org([])) == []

    def test_a_malformed_value_still_falls_back(self):
        from app.services.event_request_service import get_outreach_types

        assert get_outreach_types(self._org(None))
        assert get_outreach_types(self._org("nonsense"))

    def test_intake_still_settles_to_other_with_no_types_configured(self):
        from app.services.event_request_service import normalize_request_preferences

        settled = normalize_request_preferences(
            self._org([]),
            {
                "outreach_type": "station_tour",
                "date_flexibility": "flexible",
                "venue_preference": "either",
                "preferred_time_of_day": "morning",
                "preferred_date_start": None,
            },
        )
        assert settled["outreach_type"] == "other"


# ============================================
# Round 7 — findings on the round-6 fixes
# ============================================


class TestACancelledSignupSheetIsReplaceable:
    """A postponement to a date TBD cancels the shift and tells the crew, but
    leaves `staffing_shift_id` set. Rescheduling then moved that cancelled
    sheet's dates without restoring its status or its assignments, while
    `open_request_staffing` refused to open a replacement because the link was
    non-null — the request was permanently tied to a sheet nobody could join."""

    @staticmethod
    def _shift(status, *, finalized=False):
        from app.models.training import ShiftStatus

        return SimpleNamespace(
            id=SHIFT_UUID,
            organization_id=ORG_ID,
            status=status,
            is_finalized=finalized,
            shift_date=None,
            start_time=None,
            end_time=None,
            _cancelled=status == ShiftStatus.CANCELLED,
        )

    @pytest.mark.asyncio
    async def test_a_cancelled_sheet_reads_as_absent(self):
        from app.models.training import ShiftStatus
        from app.services.event_request_service import get_live_staffing_shift

        db = AsyncMock()
        db.scalar.return_value = self._shift(ShiftStatus.CANCELLED)
        request = SimpleNamespace(organization_id=ORG_ID, staffing_shift_id=SHIFT_UUID)

        assert await get_live_staffing_shift(db, request) is None

    @pytest.mark.asyncio
    async def test_a_live_sheet_still_reads_as_present(self):
        from app.models.training import ShiftStatus
        from app.services.event_request_service import get_live_staffing_shift

        db = AsyncMock()
        shift = self._shift(ShiftStatus.SCHEDULED)
        db.scalar.return_value = shift
        request = SimpleNamespace(organization_id=ORG_ID, staffing_shift_id=SHIFT_UUID)

        assert await get_live_staffing_shift(db, request) is shift

    @pytest.mark.asyncio
    async def test_rescheduling_does_not_move_a_cancelled_sheet(self):
        from app.models.training import ShiftStatus
        from app.services.event_request_service import sync_staffing_shift_date

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        shift = self._shift(ShiftStatus.CANCELLED)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = shift
        request = SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            staffing_shift_id=SHIFT_UUID,
            event_date=start,
            event_end_date=start + timedelta(hours=2),
        )

        await sync_staffing_shift_date(db, request, None, USER_UUID)

        # The cancelled sheet keeps its dates, and no activity row claims a
        # move that would not have brought the crew back.
        assert shift.start_time is None
        assert db.add.call_count == 0

    @pytest.mark.asyncio
    async def test_rescheduling_still_moves_a_live_sheet(self):
        from app.models.training import ShiftStatus
        from app.services.event_request_service import sync_staffing_shift_date

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        shift = self._shift(ShiftStatus.SCHEDULED)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = shift
        request = SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            staffing_shift_id=SHIFT_UUID,
            event_date=start,
            event_end_date=start + timedelta(hours=2),
        )

        await sync_staffing_shift_date(db, request, None, USER_UUID)

        assert shift.start_time == start
        assert db.add.call_count == 1

    @pytest.mark.asyncio
    async def test_signups_can_be_opened_again_after_a_cancellation(self):
        from app.api.v1.endpoints.event_requests import open_request_staffing
        from app.models.event_request import EventRequestStatus
        from app.schemas.event_request import (
            EventRequestStaffingCreate,
            StaffingRoleNeed,
        )

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        event_request = SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            status=EventRequestStatus.SCHEDULED,
            staffing_shift_id=SHIFT_UUID,
            event_date=start,
            event_end_date=start + timedelta(hours=2),
        )
        db = AsyncMock()
        db.add = MagicMock()
        db.execute.return_value = SimpleNamespace(
            scalar_one_or_none=lambda: SimpleNamespace(
                id=ORG_ID, name="Oakville", timezone="UTC", settings={}
            )
        )

        with (
            patch(
                "app.api.v1.endpoints.event_requests._load_request_for_staffing",
                AsyncMock(return_value=event_request),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.get_live_staffing_shift",
                AsyncMock(return_value=None),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.open_staffing_shift",
                AsyncMock(return_value=(SimpleNamespace(id=SHIFT_UUID), None)),
            ) as opened,
            patch(
                "app.api.v1.endpoints.event_requests.get_staffing_state",
                AsyncMock(
                    return_value={
                        "shift_id": SHIFT_UUID,
                        "shift_date": None,
                        "slots_total": 1,
                        "slots_filled": 0,
                        "roles": [],
                        "volunteers": [],
                        "volunteer_call_sent_at": None,
                    }
                ),
            ),
        ):
            await open_request_staffing(
                request_id=REQUEST_UUID,
                data=EventRequestStaffingCreate(
                    roles=[StaffingRoleNeed(role="volunteer", count=1)]
                ),
                db=db,
                current_user=SimpleNamespace(id=USER_UUID, organization_id=ORG_ID),
            )

        opened.assert_awaited()

    @pytest.mark.asyncio
    async def test_a_live_sheet_is_still_refused(self):
        from app.api.v1.endpoints.event_requests import open_request_staffing
        from app.models.event_request import EventRequestStatus
        from app.schemas.event_request import (
            EventRequestStaffingCreate,
            StaffingRoleNeed,
        )

        event_request = SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            status=EventRequestStatus.SCHEDULED,
            staffing_shift_id=SHIFT_UUID,
        )
        db = AsyncMock()

        with (
            patch(
                "app.api.v1.endpoints.event_requests._load_request_for_staffing",
                AsyncMock(return_value=event_request),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.get_live_staffing_shift",
                AsyncMock(return_value=SimpleNamespace(id=SHIFT_UUID)),
            ),
            pytest.raises(HTTPException) as exc,
        ):
            await open_request_staffing(
                request_id=REQUEST_UUID,
                data=EventRequestStaffingCreate(
                    roles=[StaffingRoleNeed(role="volunteer", count=1)]
                ),
                db=db,
                current_user=SimpleNamespace(id=USER_UUID, organization_id=ORG_ID),
            )

        assert exc.value.status_code == 409


class TestACancelledCalendarLinkIsCleared:
    """A postponement to a date TBD stands the calendar entry down but leaves
    `event_id` set. Rescheduling with `create_calendar_event=false` dropped only
    the local value, so the PATCH reported no event while the next
    request-detail response handed back the cancelled one."""

    @staticmethod
    def _db(event_request, org):
        db = AsyncMock()
        db.add = MagicMock()
        db.execute.side_effect = [
            SimpleNamespace(scalar_one_or_none=lambda: event_request),
            SimpleNamespace(scalar_one_or_none=lambda: org),
            SimpleNamespace(scalar_one_or_none=lambda: org),
        ]
        return db

    @pytest.mark.asyncio
    async def test_scheduling_without_a_calendar_entry_clears_the_stale_link(self):
        from app.api.v1.endpoints.event_requests import schedule_request
        from app.models.event_request import EventRequestStatus

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        event_request = SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            status=EventRequestStatus.POSTPONED,
            event_id=EVENT_UUID,
            event_date=None,
            event_end_date=None,
            event_location_id=None,
            staffing_shift_id=None,
            activity_log=[],
            contact_name="Pat Kelly",
            organization_name=None,
            outreach_type="station_tour",
            description="Career day",
        )
        org = SimpleNamespace(
            id=ORG_ID, name="Oakville", timezone="UTC", settings={"events": {}}
        )
        db = self._db(event_request, org)

        cancelled = SimpleNamespace(
            id=EVENT_UUID,
            organization_id=ORG_ID,
            is_cancelled=True,
            start_datetime=start - timedelta(days=7),
            end_datetime=start - timedelta(days=7) + timedelta(hours=2),
        )

        with (
            patch(
                "app.api.v1.endpoints.event_requests.get_linked_calendar_event",
                AsyncMock(return_value=cancelled),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.sync_calendar_event_date",
                AsyncMock(return_value=None),
            ) as moved,
            patch(
                "app.api.v1.endpoints.event_requests._send_request_notification",
                AsyncMock(),
            ),
        ):
            result = await schedule_request(
                request_id=REQUEST_UUID,
                data=EventRequestSchedule(
                    event_date=start, create_calendar_event=False
                ),
                db=db,
                current_user=SimpleNamespace(id=USER_UUID, organization_id=ORG_ID),
            )

        assert result["event_id"] is None
        # The persisted link is cleared too, so the detail response cannot hand
        # back an event that is not happening.
        assert event_request.event_id is None
        # A cancelled entry refuses edits by design; nothing tried to move it.
        moved.assert_not_awaited()


class TestARetiredOutreachTypeOfferedByTheFormSurvives:
    """A published form keeps the `<select>` options it was generated with, so
    a department that retires a type leaves a live form still offering it.
    `submit_form` validates the answer against exactly those options, which is
    what makes the form's vocabulary bounded rather than free text."""

    @staticmethod
    def _org():
        return SimpleNamespace(
            id=ORG_ID,
            settings={
                "events": {
                    "outreach_event_types": [
                        {"value": "station_tour", "label": "Station Tour"},
                        {"value": "other", "label": "Other"},
                    ]
                }
            },
        )

    def _settle(self, value, form_types=None):
        from app.services.event_request_service import normalize_request_preferences

        return normalize_request_preferences(
            self._org(),
            {
                "outreach_type": value,
                "date_flexibility": "flexible",
                "venue_preference": "either",
                "preferred_time_of_day": "morning",
                "preferred_date_start": None,
            },
            form_outreach_types=form_types,
        )["outreach_type"]

    def test_a_retired_type_the_form_offers_is_preserved(self):
        assert self._settle("smoke_trailer", ["smoke_trailer"]) == "smoke_trailer"

    def test_a_value_no_vocabulary_knows_still_settles_to_other(self):
        assert self._settle("smoke_trailer") == "other"
        assert self._settle("<script>", ["station_tour"]) == "other"

    def test_a_configured_type_is_unaffected(self):
        assert self._settle("station_tour", ["smoke_trailer"]) == "station_tour"

    def test_the_form_vocabulary_is_still_length_bounded(self):
        from app.services.event_request_service import OUTREACH_TYPE_MAX_LENGTH

        long_value = "x" * (OUTREACH_TYPE_MAX_LENGTH + 50)
        assert len(self._settle(long_value, [long_value])) == OUTREACH_TYPE_MAX_LENGTH

    def test_only_choice_fields_contribute_a_vocabulary(self):
        from app.models.forms import FieldType

        service = FormsService(AsyncMock())
        select_field = SimpleNamespace(
            id="f1",
            label="Outreach Type",
            field_type=FieldType.SELECT.value,
            options=[{"value": "smoke_trailer", "label": "Smoke Trailer"}],
        )
        text_field = SimpleNamespace(
            id="f2",
            label="Type",
            field_type=FieldType.TEXT.value,
            options=[{"value": "anything", "label": "Anything"}],
        )
        form = SimpleNamespace(fields=[select_field, text_field])

        values = service._mapped_field_options(
            IntegrationType.EVENT_REQUEST, "outreach_type", None, form
        )

        # A free-text field's answer is whatever somebody typed, so it is not a
        # vocabulary and contributes nothing.
        assert values == {"smoke_trailer"}

    def test_an_explicit_field_mapping_is_honoured(self):
        from app.models.forms import FieldType

        service = FormsService(AsyncMock())
        field = SimpleNamespace(
            id="f9",
            label="What are you after?",
            field_type=FieldType.RADIO.value,
            options=[{"value": "smoke_trailer", "label": "Smoke Trailer"}],
        )
        form = SimpleNamespace(fields=[field])
        integration = SimpleNamespace(field_mappings={"f9": "outreach_type"})

        values = service._mapped_field_options(
            IntegrationType.EVENT_REQUEST, "outreach_type", integration, form
        )

        assert values == {"smoke_trailer"}

    def test_no_form_means_no_vocabulary(self):
        service = FormsService(AsyncMock())

        assert (
            service._mapped_field_options(
                IntegrationType.EVENT_REQUEST, "outreach_type", None, None
            )
            == set()
        )


class TestTheBackfillComparesAccentSensitively:
    """`utf8mb4_unicode_ci` is accent-insensitive as well as case-insensitive,
    so an off-list "mörning" compared *equal* to "morning" under the column's
    own collation: it took the preserving branch and stayed stored off-list,
    which is what this migration exists to end."""

    BACKFILL = TestPreferenceBackfill.BACKFILL

    def test_both_sides_of_the_comparison_are_cast_to_binary(self):
        text = self.BACKFILL.read_text()
        assert "CAST(LOWER(TRIM({column})) AS BINARY)" in text
        assert "CAST(:v{i} AS BINARY)" in text

    def test_the_preserving_branch_still_writes_the_normalized_value(self):
        # Bytes decide *whether* to preserve; what gets stored is still the
        # LOWER(TRIM(...)) form, so " Morning" lands as "morning".
        assert "THEN LOWER(TRIM({column}))" in self.BACKFILL.read_text()


# ============================================
# Round 8 — findings on the round-7 fixes
# ============================================


class TestAnInfiniteAudienceSizeIsJustUnparseable:
    """`float()` accepts "1e309", "inf" and "Infinity"; `int(inf)` then raises
    OverflowError, not ValueError. Uncaught it escaped this parser's lenient
    contract and failed the whole integration, losing a community enquiry over
    the one field the parser is allowed to give up on."""

    @pytest.mark.parametrize("value", ["1e309", "inf", "-inf", "Infinity", "nan"])
    def test_a_non_finite_answer_costs_the_field_not_the_request(self, value):
        assert parse_audience_size(value) is None

    def test_a_large_but_finite_answer_still_clamps(self):
        from app.services.event_request_service import AUDIENCE_SIZE_MAX

        assert parse_audience_size("1e300") == AUDIENCE_SIZE_MAX

    def test_ordinary_answers_are_unaffected(self):
        assert parse_audience_size("40") == 40
        assert parse_audience_size("40.7") == 40


class TestAZeroLengthScheduledWindowIsRefused:
    """`EventCreate` and `EventUpdate` both refuse an end at or before the
    start, and `schedule_request` builds `EventCreate` outside an exception
    handler — so an end *equal* to the start became a 500 rather than a 422 at
    this boundary. A zero-length window also overlaps nothing, so the room
    double-booking check passed it on the way there."""

    def test_an_end_equal_to_the_start_is_refused(self):
        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)

        with pytest.raises(ValidationError):
            EventRequestSchedule(event_date=start, event_end_date=start)

    def test_a_reversed_window_is_still_refused(self):
        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)

        with pytest.raises(ValidationError):
            EventRequestSchedule(
                event_date=start, event_end_date=start - timedelta(hours=1)
            )

    def test_a_real_window_is_accepted(self):
        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        data = EventRequestSchedule(
            event_date=start, event_end_date=start + timedelta(hours=2)
        )

        assert data.event_end_date == start + timedelta(hours=2)

    def test_it_matches_the_postpone_validator(self):
        """Both paths set a confirmed date; one rule, not two."""
        from app.schemas.event_request import EventRequestPostpone

        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        with pytest.raises(ValidationError):
            EventRequestPostpone(new_event_date=start, new_event_end_date=start)


class TestANewRoomReachesTheCalendarEntry:
    """`schedule_request` stores `event_location_id` before deciding what to do
    with the calendar entry. With `create_calendar_event=false` the sync path
    sent only the times, so the request and its activity row named the new room
    while the entry stayed in the old one."""

    LOCATION_ID = "00000000-0000-0000-0000-0000000000c3"
    OLD_LOCATION_ID = "00000000-0000-0000-0000-0000000000c4"

    def _linked(self, location_id):
        start = datetime(2026, 11, 4, 14, 0, tzinfo=timezone.utc)
        return SimpleNamespace(
            id=EVENT_UUID,
            organization_id=ORG_ID,
            is_cancelled=False,
            location_id=location_id,
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
        )

    def _request(self, start):
        return SimpleNamespace(
            id=REQUEST_UUID,
            organization_id=ORG_ID,
            event_id=EVENT_UUID,
            event_date=start,
            event_end_date=start + timedelta(hours=2),
        )

    @pytest.mark.asyncio
    async def test_the_room_is_sent_with_the_move(self):
        from app.services.event_request_service import sync_calendar_event_date

        start = datetime(2026, 11, 11, 14, 0, tzinfo=timezone.utc)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = self._linked(self.OLD_LOCATION_ID)
        captured: dict = {}

        class _Recording:
            def __init__(self, _db):
                self.update_event = AsyncMock(
                    side_effect=lambda **kw: captured.update(kw)
                )

        with patch("app.services.event_service.EventService", _Recording):
            refusal = await sync_calendar_event_date(
                db, self._request(start), USER_UUID, location_id=self.LOCATION_ID
            )

        assert refusal is None
        assert str(captured["event_data"].location_id) == self.LOCATION_ID

    @pytest.mark.asyncio
    async def test_a_room_change_alone_still_updates_the_entry(self):
        """The times did not move, but returning early would leave the entry in
        the old room while the request names the new one."""
        from app.services.event_request_service import sync_calendar_event_date

        linked = self._linked(self.OLD_LOCATION_ID)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = linked
        captured: dict = {}

        class _Recording:
            def __init__(self, _db):
                self.update_event = AsyncMock(
                    side_effect=lambda **kw: captured.update(kw)
                )

        with patch("app.services.event_service.EventService", _Recording):
            refusal = await sync_calendar_event_date(
                db,
                self._request(linked.start_datetime),
                USER_UUID,
                location_id=self.LOCATION_ID,
            )

        assert refusal is None
        assert str(captured["event_data"].location_id) == self.LOCATION_ID

    @pytest.mark.asyncio
    async def test_naming_no_room_leaves_the_existing_one_alone(self):
        """An omitted key on an update payload means "leave this alone"; a
        postponement must not clear the room the entry already had."""
        from app.services.event_request_service import sync_calendar_event_date

        start = datetime(2026, 11, 11, 14, 0, tzinfo=timezone.utc)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = self._linked(self.OLD_LOCATION_ID)
        captured: dict = {}

        class _Recording:
            def __init__(self, _db):
                self.update_event = AsyncMock(
                    side_effect=lambda **kw: captured.update(kw)
                )

        with patch("app.services.event_service.EventService", _Recording):
            await sync_calendar_event_date(db, self._request(start), USER_UUID)

        assert "location_id" not in captured["event_data"].model_dump(
            exclude_unset=True
        )

    @pytest.mark.asyncio
    async def test_an_unchanged_room_and_time_still_short_circuits(self):
        from app.services.event_request_service import sync_calendar_event_date

        linked = self._linked(self.LOCATION_ID)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = linked

        class _Unexpected:
            def __init__(self, _db):
                self.update_event = AsyncMock(
                    side_effect=AssertionError("should not be called")
                )

        with patch("app.services.event_service.EventService", _Unexpected):
            refusal = await sync_calendar_event_date(
                db,
                self._request(linked.start_datetime),
                USER_UUID,
                location_id=self.LOCATION_ID,
            )

        assert refusal is None
        assert db.add.call_count == 0

    @pytest.mark.asyncio
    async def test_a_room_conflict_on_this_path_reaches_the_coordinator(self):
        from app.services.event_request_service import sync_calendar_event_date

        start = datetime(2026, 11, 11, 14, 0, tzinfo=timezone.utc)
        db = AsyncMock()
        db.add = MagicMock()
        db.scalar.return_value = self._linked(self.OLD_LOCATION_ID)

        class _Conflicting:
            def __init__(self, _db):
                self.update_event = AsyncMock(
                    side_effect=ValueError("Location is already booked")
                )

        with patch("app.services.event_service.EventService", _Conflicting):
            refusal = await sync_calendar_event_date(
                db, self._request(start), USER_UUID, location_id=self.LOCATION_ID
            )

        assert refusal == "Location is already booked"
        assert db.add.call_count == 0
