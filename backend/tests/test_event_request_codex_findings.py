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
            "app.api.v1.endpoints.event_requests.sync_calendar_event_date", AsyncMock()
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

    @pytest.mark.parametrize("stored", ["a string", 42, {}, []])
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
