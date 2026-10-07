"""
Target Solutions sync: the Training Records API and email-based member matching.

TargetSolutions documents completions export as its Training Records API: one
GET to ``/tsapp/api/?action=reports.buildReport&reportType=completionsall``,
authenticated by ``key`` and ``secret`` query parameters, returning a CSV whose
columns include Employee ID, Email and Transcript ID. The integration used to
send TARGET_SOLUTIONS providers to the Vector Solutions REST API instead, which
takes a different credential and returns certifications, not completions.

Member matching by email ran only once, when a mapping row was first created,
so a member whose Logbook email was added after the first sync never matched.
"""

import logging
import uuid
from datetime import date, datetime, timezone

import httpx
import pytest

from app.core.logging import (
    _sentry_before_breadcrumb,
    _sentry_before_send,
    _sentry_before_send_transaction,
    install_httpx_url_redaction,
    redact_url_secrets,
)
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    ExternalTrainingSyncLog,
    ExternalUserMapping,
    SyncStatus,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training import (
    ExternalTrainingProviderCreate,
    ExternalTrainingProviderUpdate,
)
from app.services.external_training_service import ExternalTrainingSyncService

TS_BASE_URL = "https://app.targetsolutions.com/tsapp/api/"
TS_KEY = "32D4C23ADD5B9286F9DAFE6166E01F5"
TS_SECRET = "B9D0FFC80322877B3"

CSV_HEADER = (
    "Employee ID,Email,Assignment Name,Assignment Type,Assigned By,Date Assigned,"
    "Date Due,Completion Date,Completion Time,Time Spent In Course,Test Score,"
    "Test Attempts,Tags,Course ID,Transcript ID,RMS Code,Duration (hours),Instructor"
)


def _csv_row(
    employee_id="E-501",
    email="Jane.Doe@Dept.test ",
    title="Hazmat Awareness",
    completion_date="09/01/2026",
    transcript_id="T-9001",
    score="85%",
    hours="1.5",
    course_id="C-77",
):
    return (
        f"{employee_id},{email},{title},Course,Chief,08/01/2026,09/30/2026,"
        f"{completion_date},14:30,01:30,{score},1,,{course_id},{transcript_id},,"
        f"{hours},"
    )


def _csv(*rows):
    return "\n".join([CSV_HEADER, *rows]) + "\n"


# What the live report puts above the header row: a title block of report
# metadata, each line padded with commas to the report's width. The live header
# also ends with a Location column.
LIVE_PREAMBLE = (
    "Completions (via API),,,,,,,,,,,,,,,,,,\n"
    "Report executed 10/07/2026,,,,,,,,,,,,,,,,,,\n"
    "User Status: Active/Offline,,,,,,,,,,,,,,,,,,\n"
    "Assignment Type: All Assignments,,,,,,,,,,,,,,,,,,\n"
    "Completion Date Range: From 09/01/2026 To 10/01/2026,,,,,,,,,,,,,,,,,,\n"
)
LIVE_HEADER = CSV_HEADER + ",Location"


def _live_csv(*rows):
    return LIVE_PREAMBLE + "\n".join([LIVE_HEADER, *rows]) + "\n"


def _ts_provider(api_key=TS_KEY, api_secret=TS_SECRET):
    return ExternalTrainingProvider(
        id="prov-1",
        organization_id="org-1",
        name="Target Solutions",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
        api_base_url=TS_BASE_URL,
        api_key=api_key,
        api_secret=api_secret,
        auth_type="api_key",
    )


class _Recorder:
    def __init__(self, status=200, body=""):
        self.status = status
        self.body = body
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self.status, content=self.body.encode("utf-8"))


async def _service_with(recorder: _Recorder, db=None) -> ExternalTrainingSyncService:
    service = ExternalTrainingSyncService(db)
    await service.http_client.aclose()
    service.http_client = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    return service


@pytest.mark.unit
class TestTrainingRecordsRequest:
    async def test_requests_the_completions_report_with_key_secret_and_dates(self):
        recorder = _Recorder(body=_csv(_csv_row()))
        service = await _service_with(recorder)
        try:
            await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
            )
        finally:
            await service.close()

        (request,) = recorder.requests
        assert request.method == "GET"
        assert str(request.url).startswith(TS_BASE_URL + "?")
        assert dict(request.url.params) == {
            "action": "reports.buildReport",
            "reportType": "completionsall",
            "key": TS_KEY,
            "secret": TS_SECRET,
            "startDate": "09-01-2026",
            "endDate": "09-29-2026",
        }
        # The credentials travel only in the query string.
        assert "AccessToken" not in request.headers
        assert "Authorization" not in request.headers

    async def test_maps_the_csv_columns(self):
        recorder = _Recorder(body="﻿" + _csv(_csv_row()))
        service = await _service_with(recorder)
        try:
            (record,) = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
            )
        finally:
            await service.close()

        assert record["external_record_id"] == "T-9001"
        assert record["external_user_id"] == "E-501"
        assert record["external_email"] == "Jane.Doe@Dept.test"
        assert record["course_title"] == "Hazmat Awareness"
        assert record["course_code"] == "C-77"
        assert record["credit_hours"] == 1.5
        # The import endpoints read hours from duration_minutes.
        assert record["duration_minutes"] == 90
        assert record["score"] == 85.0
        assert record["passed"] is True
        assert service._parse_date(record["completion_date"]).date() == date(2026, 9, 1)

    async def test_blank_transcript_id_falls_back_to_a_stable_key(self):
        recorder = _Recorder(body=_csv(_csv_row(transcript_id="")))
        service = await _service_with(recorder)
        try:
            first = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
            )
            second = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
            )
        finally:
            await service.close()

        assert first[0]["external_record_id"]
        assert first[0]["external_record_id"] == second[0]["external_record_id"]

    async def test_skips_blank_rows_and_rows_naming_no_assignment(self):
        body = _csv(_csv_row(), ",,,,,,,,,,,,,,,,,", _csv_row(title="", course_id=""))
        recorder = _Recorder(body=body)
        service = await _service_with(recorder)
        try:
            records = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
            )
        finally:
            await service.close()
        assert [r["external_record_id"] for r in records] == ["T-9001"]

    async def test_reads_past_the_live_reports_title_block(self):
        rows = [
            # The live report's own shapes: unpadded m/d/yyyy dates, a 12-hour
            # time, a quoted title with a comma, and an Admin assignment whose
            # score is the word "Completed" and whose duration is blank.
            "1001,member.one@dept.test,CAPCE Back Injury Prevention (2755653),"
            'TS Course,"One, Member",9/1/2026,,9/1/2026,4:50 PM,43,95%,1,,'
            "2755653,558932162,,1,,",
            '1002,member.two@dept.test,"General First Aid, Part I",TS Course,'
            '"Two, Member",9/24/2026,,9/24/2026,10:47 PM,4,90%,1,,3777,'
            "561945159,,1,,",
            "1002,member.two@dept.test,Code of Conduct,Admin,,9/24/2026,,"
            "9/25/2026,12:17 AM,,Completed,,,1472902,561939704,,,,",
        ]
        recorder = _Recorder(body=_live_csv(*rows))
        service = await _service_with(recorder)
        try:
            first, second, admin = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 10, 1)
            )
        finally:
            await service.close()

        assert first["external_record_id"] == "558932162"
        assert first["external_user_id"] == "1001"
        assert first["external_email"] == "member.one@dept.test"
        assert first["course_title"] == "CAPCE Back Injury Prevention (2755653)"
        assert first["credit_hours"] == 1.0
        assert first["score"] == 95.0
        assert service._parse_date(first["completion_date"]).date() == date(2026, 9, 1)
        assert second["course_title"] == "General First Aid, Part I"
        assert admin["training_type"] == "Admin"
        assert admin["score"] is None
        assert admin["credit_hours"] is None
        assert admin["raw_data"]["Location"] == ""

    async def test_live_report_with_no_completions_is_no_records(self):
        service = await _service_with(_Recorder(body=_live_csv()))
        try:
            records = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 10, 1)
            )
        finally:
            await service.close()
        assert records == []

    async def test_title_block_without_a_header_row_is_rejected(self):
        service = await _service_with(_Recorder(body=LIVE_PREAMBLE))
        try:
            with pytest.raises(ValueError, match="did not return a completions"):
                await service._fetch_external_records(
                    _ts_provider(), date(2026, 9, 1), date(2026, 10, 1)
                )
        finally:
            await service.close()

    async def test_empty_report_is_no_records(self):
        service = await _service_with(_Recorder(body=""))
        try:
            records = await service._fetch_external_records(
                _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
            )
        finally:
            await service.close()
        assert records == []

    @pytest.mark.parametrize(
        ("status", "body"),
        [
            (200, "<html>Invalid key</html>"),
            (401, "denied"),
            (500, "boom"),
        ],
    )
    async def test_errors_never_carry_the_credentials(self, status, body):
        service = await _service_with(_Recorder(status=status, body=body))
        try:
            with pytest.raises(ValueError, match="Target Solutions") as exc:
                await service._fetch_external_records(
                    _ts_provider(), date(2026, 9, 1), date(2026, 9, 29)
                )
        finally:
            await service.close()
        message = str(exc.value)
        assert TS_KEY not in message
        assert TS_SECRET not in message
        assert body not in message

    async def test_missing_secret_is_rejected_before_any_request(self):
        recorder = _Recorder(body=_csv())
        service = await _service_with(recorder)
        try:
            with pytest.raises(ValueError, match="key and secret"):
                await service._fetch_external_records(
                    _ts_provider(api_secret=None), date(2026, 9, 1), date(2026, 9, 29)
                )
        finally:
            await service.close()
        assert recorder.requests == []


@pytest.mark.unit
class TestTrainingRecordsConnectionTest:
    async def test_success_requests_today_only(self):
        recorder = _Recorder(body=_csv(_csv_row()))
        service = await _service_with(recorder)
        try:
            ok, message = await service.test_connection(_ts_provider())
        finally:
            await service.close()
        assert ok is True
        assert "1 record" in message
        params = dict(recorder.requests[0].url.params)
        assert "startDate" not in params
        assert "endDate" not in params

    async def test_live_report_title_block_passes(self):
        recorder = _Recorder(body=_live_csv())
        service = await _service_with(recorder)
        try:
            ok, message = await service.test_connection(_ts_provider())
        finally:
            await service.close()
        assert ok is True, message
        assert "0 record" in message

    async def test_bad_credentials_fail_without_echoing_them(self):
        service = await _service_with(_Recorder(status=200, body="Invalid key"))
        try:
            ok, message = await service.test_connection(_ts_provider())
        finally:
            await service.close()
        assert ok is False
        assert TS_SECRET not in message

    async def test_missing_secret_fails(self):
        service = await _service_with(_Recorder(body=_csv()))
        try:
            ok, message = await service.test_connection(_ts_provider(api_secret=None))
        finally:
            await service.close()
        assert ok is False
        assert "secret" in message


@pytest.mark.unit
class TestCredentialRedaction:
    URL = f"{TS_BASE_URL}?action=reports.buildReport&key={TS_KEY}&secret={TS_SECRET}"

    def test_redacts_key_and_secret_query_values(self):
        redacted = redact_url_secrets(self.URL)
        assert TS_KEY not in redacted
        assert TS_SECRET not in redacted
        assert "action=reports.buildReport" in redacted

    def test_redacts_a_bare_query_string(self):
        redacted = redact_url_secrets(f"key={TS_KEY}&startDate=09-01-2026")
        assert TS_KEY not in redacted
        assert "startDate=09-01-2026" in redacted

    def test_httpx_request_log_line_is_redacted(self):
        install_httpx_url_redaction()
        seen: list[str] = []

        class _Capture(logging.Handler):
            def emit(self, record):
                seen.append(record.getMessage())

        httpx_logger = logging.getLogger("httpx")
        handler = _Capture()
        httpx_logger.addHandler(handler)
        previous = httpx_logger.level
        httpx_logger.setLevel(logging.INFO)
        try:
            # The exact call httpx makes for every request.
            httpx_logger.info(
                'HTTP Request: %s %s "%s %d %s"',
                "GET",
                httpx.URL(self.URL),
                "HTTP/1.1",
                200,
                "OK",
            )
        finally:
            httpx_logger.removeHandler(handler)
            httpx_logger.setLevel(previous)

        assert len(seen) == 1
        assert TS_SECRET not in seen[0]
        assert TS_KEY not in seen[0]

    def test_sentry_breadcrumb_and_span_queries_are_redacted(self):
        query = f"action=reports.buildReport&key={TS_KEY}&secret={TS_SECRET}"
        crumb = _sentry_before_breadcrumb(
            {"category": "httplib", "data": {"http.query": query}}, {}
        )
        assert TS_SECRET not in crumb["data"]["http.query"]

        event = _sentry_before_send_transaction(
            {"spans": [{"op": "http.client", "data": {"http.query": query}}]}, {}
        )
        assert TS_SECRET not in event["spans"][0]["data"]["http.query"]

    def test_sentry_error_event_frame_variables_are_scrubbed(self):
        # What Sentry attaches for a failure inside _target_solutions_report.
        event = {
            "exception": {
                "values": [
                    {
                        "stacktrace": {
                            "frames": [
                                {
                                    "vars": {
                                        "params": {
                                            "action": "reports.buildReport",
                                            "key": TS_KEY,
                                            "secret": TS_SECRET,
                                        },
                                        "request": f"<Request('GET', '{self.URL}')>",
                                        "key": TS_KEY,
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        }
        scrubbed = str(_sentry_before_send(event, {}))
        assert TS_KEY not in scrubbed
        assert TS_SECRET not in scrubbed
        assert "reports.buildReport" in scrubbed

    async def test_sync_failure_message_never_carries_the_url_credentials(self):
        class _Db:
            def add(self, obj):
                pass

            async def flush(self):
                pass

            async def commit(self):
                pass

        service = ExternalTrainingSyncService(_Db())

        async def _boom(*_a, **_k):
            raise RuntimeError(f"upstream failure for {self.URL}")

        service._fetch_external_records = _boom
        try:
            log = await service.sync_training_records(_ts_provider(), "manual")
        finally:
            await service.close()
        assert log.status == SyncStatus.FAILED
        assert TS_SECRET not in log.error_message


@pytest.mark.unit
class TestProviderUrlRejectsCredentials:
    PASTED = f"{TS_BASE_URL}?action=reports.buildReport&key={TS_KEY}&secret={TS_SECRET}"

    def test_create_rejects_a_pasted_report_url(self):
        with pytest.raises(ValueError, match="must not contain a key, secret or token"):
            ExternalTrainingProviderCreate(
                name="TS",
                provider_type=ExternalProviderType.TARGET_SOLUTIONS,
                api_base_url=self.PASTED,
            )

    def test_update_rejects_a_pasted_report_url(self):
        with pytest.raises(ValueError, match="must not contain a key, secret or token"):
            ExternalTrainingProviderUpdate(api_base_url=self.PASTED)

    def test_plain_base_url_and_lookalike_params_are_accepted(self):
        assert (
            ExternalTrainingProviderCreate(
                name="TS",
                provider_type=ExternalProviderType.TARGET_SOLUTIONS,
                api_base_url=TS_BASE_URL,
            ).api_base_url
            == TS_BASE_URL
        )
        assert ExternalTrainingProviderUpdate(
            api_base_url="https://lms.example.test/?keyword=fire"
        ).api_base_url.endswith("keyword=fire")


@pytest.mark.unit
class TestVectorSolutionsUnchanged:
    async def test_vector_solutions_still_sends_access_token(self):
        provider = ExternalTrainingProvider(
            id="prov-2",
            organization_id="org-1",
            name="Vector Solutions",
            provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
            api_base_url="https://app.targetsolutions.com/v1",
            api_key="tok-123",
            config={"site_id": "42"},
        )
        service = ExternalTrainingSyncService(db=None)
        try:
            headers = service._get_auth_headers(provider)
        finally:
            await service.close()
        assert headers["AccessToken"] == "tok-123"
        assert "Authorization" not in headers

    async def test_null_user_id_is_empty_not_the_string_none(self):
        service = ExternalTrainingSyncService(db=None)
        try:
            normalized = service._normalize_vector_solutions_record(
                {"id": 7, "userId": None, "email": "a@b.test"}
            )
        finally:
            await service.close()
        assert normalized["external_user_id"] == ""


async def _make_org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="TS Sync Test Department",
        slug=f"ts-sync-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _make_user(
    db_session, org, email, deleted=False, membership_number=None
) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u{uuid.uuid4().hex[:10]}",
        email=email,
        membership_number=membership_number,
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _make_provider(
    db_session, org, provider_type=ExternalProviderType.TARGET_SOLUTIONS
) -> ExternalTrainingProvider:
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Target Solutions",
        provider_type=provider_type,
        api_base_url=TS_BASE_URL,
    )
    db_session.add(provider)
    await db_session.flush()
    return provider


async def _make_sync_log(db_session, provider) -> ExternalTrainingSyncLog:
    log = ExternalTrainingSyncLog(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=provider.organization_id,
        sync_type="manual",
        status=SyncStatus.IN_PROGRESS,
    )
    db_session.add(log)
    await db_session.flush()
    return log


def _row(**overrides):
    """One parsed CSV row, as _target_solutions_report returns it."""
    row = {
        "Employee ID": "E-501",
        "Email": "Jane.Doe@Dept.test",
        "Assignment Name": "Hazmat Awareness",
        "Assignment Type": "Course",
        "Completion Date": "09/01/2026",
        "Completion Time": "14:30",
        "Test Score": "85",
        "Course ID": "C-77",
        "Transcript ID": "T-9001",
        "Duration (hours)": "1.5",
    }
    row.update(overrides)
    return row


@pytest.mark.integration
class TestEmailMatching:
    async def _process(self, db_session, provider, log, row):
        service = ExternalTrainingSyncService(db_session)
        try:
            record = service._normalize_target_solutions_record(row)
            result = await service._process_external_record(provider, log.id, record)
            await db_session.flush()
            return result
        finally:
            await service.close()

    async def _import_row(self, db_session, provider, record_id="T-9001"):
        return (
            await db_session.execute(
                ExternalTrainingImport.__table__.select().where(
                    ExternalTrainingImport.provider_id == provider.id,
                    ExternalTrainingImport.external_record_id == record_id,
                )
            )
        ).one()

    async def _mapping(self, db_session, provider):
        return (
            await db_session.execute(
                ExternalUserMapping.__table__.select().where(
                    ExternalUserMapping.provider_id == provider.id
                )
            )
        ).one()

    async def test_stages_the_completion_for_the_member_with_that_email(
        self, db_session
    ):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org, "jane.doe@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        assert await self._process(db_session, provider, log, _row()) == "imported"

        row = await self._import_row(db_session, provider)
        assert row.user_id == member.id
        assert row.course_title == "Hazmat Awareness"
        assert row.duration_minutes == 90
        assert row.credit_hours == 1.5
        assert row.completion_date.date() == date(2026, 9, 1)

    async def test_never_matches_a_deleted_member(self, db_session):
        org = await _make_org(db_session)
        await _make_user(db_session, org, "jane.doe@dept.test", deleted=True)
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_does_not_match_a_member_of_another_org(self, db_session):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        await _make_user(db_session, other, "jane.doe@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_later_sync_matches_a_member_whose_email_was_added(self, db_session):
        org = await _make_org(db_session)
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())
        assert (await self._import_row(db_session, provider)).user_id is None

        member = await _make_user(db_session, org, "jane.doe@dept.test")
        assert await self._process(db_session, provider, log, _row()) == "updated"

        assert (await self._import_row(db_session, provider)).user_id == member.id
        mapping = await self._mapping(db_session, provider)
        assert mapping.internal_user_id == member.id
        assert mapping.auto_mapped is True

    async def test_later_sync_never_overrides_an_officer_decision(self, db_session):
        org = await _make_org(db_session)
        officer = await _make_user(db_session, org, "chief@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())
        mapping = await self._mapping(db_session, provider)
        # An officer deliberately leaves this external user unmapped.
        await db_session.execute(
            ExternalUserMapping.__table__.update()
            .where(ExternalUserMapping.id == mapping.id)
            .values(mapped_by=officer.id)
        )

        await _make_user(db_session, org, "jane.doe@dept.test")
        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_row_with_email_but_no_employee_id_still_maps(self, db_session):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org, "jane.doe@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row(**{"Employee ID": ""}))

        row = await self._import_row(db_session, provider)
        assert row.user_id == member.id
        assert row.external_user_id == "jane.doe@dept.test"

    async def test_unmatched_email_falls_back_to_membership_number(self, db_session):
        org = await _make_org(db_session)
        member = await _make_user(
            db_session, org, "jdoe@personal.test", membership_number="E-501"
        )
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id == member.id
        mapping = await self._mapping(db_session, provider)
        assert mapping.internal_user_id == member.id
        assert mapping.auto_mapped is True

    async def test_email_match_wins_over_membership_number(self, db_session):
        org = await _make_org(db_session)
        by_email = await _make_user(db_session, org, "jane.doe@dept.test")
        await _make_user(db_session, org, "other@dept.test", membership_number="E-501")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id == by_email.id

    async def test_membership_number_never_matches_a_deleted_member(self, db_session):
        org = await _make_org(db_session)
        await _make_user(
            db_session,
            org,
            "gone@dept.test",
            deleted=True,
            membership_number="E-501",
        )
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_membership_number_is_scoped_to_the_org(self, db_session):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        await _make_user(db_session, other, "else@dept.test", membership_number="E-501")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_later_sync_matches_a_membership_number_added_later(self, db_session):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org, "jdoe@personal.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())
        assert (await self._import_row(db_session, provider)).user_id is None

        await db_session.execute(
            User.__table__.update()
            .where(User.id == member.id)
            .values(membership_number="E-501")
        )
        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id == member.id

    async def test_other_providers_never_match_on_membership_number(self, db_session):
        # A Vector Solutions user id is Vector's own key; one that equals a
        # membership number is a coincidence, not an identity.
        org = await _make_org(db_session)
        await _make_user(
            db_session, org, "jdoe@personal.test", membership_number="E-501"
        )
        provider = await _make_provider(
            db_session, org, provider_type=ExternalProviderType.VECTOR_SOLUTIONS
        )
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_blank_employee_id_never_compares_the_email_as_a_number(
        self, db_session
    ):
        # With no Employee ID the email becomes the external user id; it must
        # not be looked up as a membership number.
        org = await _make_org(db_session)
        await _make_user(
            db_session,
            org,
            "someone@dept.test",
            membership_number="jane.doe@dept.test",
        )
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row(**{"Employee ID": ""}))

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_resync_updates_the_same_transcript(self, db_session):
        org = await _make_org(db_session)
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _row())
        result = await self._process(
            db_session, provider, log, _row(**{"Completion Date": "09/15/2026"})
        )

        assert result == "updated"
        row = await self._import_row(db_session, provider)
        assert row.completion_date.date() == date(2026, 9, 15)
