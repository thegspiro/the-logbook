"""
A Target Solutions completions report can be uploaded by hand, and a completion
is never recorded twice however it arrives.

The upload is the same CSV the Training Records API returns, so it goes through
the same parser and stages the same records, keyed by Transcript ID. That key
is what keeps an upload and an API sync from duplicating each other in either
order, and it is backed three ways: the two paths take turns on the provider
row, the staged table is unique per (provider, Transcript ID), and a training
record that already carries the Transcript ID is linked rather than created
again.
"""

import io
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import external_training as endpoints
from app.api.v1.endpoints.external_training import (
    import_single_record,
    upload_report,
)
from app.api.v1.endpoints.training import VALID_TRAINING_TYPES
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    ExternalTrainingSyncLog,
    TrainingRecord,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training import ImportRecordRequest
from app.services.external_training_service import (
    UPLOAD_SYNC_TYPE,
    ExternalTrainingSyncService,
)

PREAMBLE = (
    "Completions (via API),,,,,,,,,,,,,,,,,,\n"
    "Report executed 10/07/2026,,,,,,,,,,,,,,,,,,\n"
    "User Status: Active/Offline,,,,,,,,,,,,,,,,,,\n"
    "Assignment Type: All Assignments,,,,,,,,,,,,,,,,,,\n"
    "Completion Date Range: From 09/01/2026 To 10/01/2026,,,,,,,,,,,,,,,,,,\n"
)
HEADER = (
    "Employee ID,Email,Assignment Name,Assignment Type,Assigned By,Date Assigned,"
    "Date Due,Completion Date,Completion Time,Time Spent In Course,Test Score,"
    "Test Attempts,Tags,Course ID,Transcript ID,RMS Code,Duration (hours),"
    "Instructor,Location"
)


def _row(employee_id, email, title, completed, transcript, hours="1"):
    return (
        f'{employee_id},{email},"{title}",TS Course,,{completed},,{completed},'
        f"4:50 PM,43,95%,1,,2755653,{transcript},,{hours},,"
    )


MATCHED = _row("1001", "pat@dept.test", "Back Injury Prevention", "9/1/2026", "T-1")
MATCHED_2 = _row("1001", "pat@dept.test", "Aquatic Emergencies", "9/5/2026", "T-2")
UNMATCHED = _row("9999", "nobody@else.test", "Sepsis", "9/30/2026", "T-3")


def _admin_row(employee_id, email, title, course_id, completed, at, transcript):
    """An Admin row as the live report has it: no score, hours or assigner."""
    return (
        f"{employee_id},{email},{title},Admin,,{completed},,{completed},{at},,"
        f"Completed,,,{course_id},{transcript},,,,"
    )


CONDUCT = _admin_row(
    "1001",
    "pat@dept.test",
    "FCVFD Code of Conduct",
    "1472902",
    "9/25/2026",
    "12:17 AM",
    "A-1",
)
CONDUCT_AGAIN = _admin_row(
    "1001",
    "pat@dept.test",
    "FCVFD Code of Conduct",
    "1472902",
    "9/25/2026",
    "12:18 AM",
    "A-2",
)
WHISTLEBLOWER = _admin_row(
    "1001",
    "pat@dept.test",
    "FCVFD Whistleblower Policy",
    "1462061",
    "9/25/2026",
    "12:21 AM",
    "A-3",
)
CONDUCT_NEXT_YEAR = _admin_row(
    "1001",
    "pat@dept.test",
    "FCVFD Code of Conduct",
    "1472902",
    "9/24/2027",
    "9:00 AM",
    "A-4",
)


def _report(*rows):
    return PREAMBLE + "\n".join([HEADER, *rows]) + "\n"


def _upload(text, filename="report_completionsall.csv"):
    return UploadFile(file=io.BytesIO(text.encode("utf-8")), filename=filename)


async def _setup(db_session, provider_type=ExternalProviderType.TARGET_SOLUTIONS):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Upload Test Department",
        slug=f"up-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u{uuid.uuid4().hex[:10]}",
        email="pat@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(member)
    # No key or secret: upload must not need them.
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Target Solutions",
        provider_type=provider_type,
        api_base_url="https://app.targetsolutions.com/tsapp/api/",
    )
    db_session.add(provider)
    await db_session.flush()
    return org, member, provider


async def _count(db_session, model, **where):
    query = select(func.count()).select_from(model)
    for column, value in where.items():
        query = query.where(getattr(model, column) == value)
    return (await db_session.execute(query)).scalar_one()


async def _records_for(db_session, provider):
    return (
        (
            await db_session.execute(
                select(TrainingRecord)
                .where(TrainingRecord.external_provider_id == provider.id)
                .order_by(TrainingRecord.external_record_id)
            )
        )
        .scalars()
        .all()
    )


async def _staged(db_session, provider, record_id):
    return (
        await db_session.execute(
            select(ExternalTrainingImport).where(
                ExternalTrainingImport.provider_id == provider.id,
                ExternalTrainingImport.external_record_id == record_id,
            )
        )
    ).scalar_one()


@pytest.mark.integration
class TestUploadCreditsMembers:
    async def test_matched_rows_become_training_records(self, db_session):
        _, member, provider = await _setup(db_session)

        response = await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(MATCHED, MATCHED_2, UNMATCHED)),
            db_session,
            member,
        )

        assert response.rows_in_report == 3
        assert response.new_rows == 3
        assert response.training_records_created == 2
        assert response.awaiting_member == 1
        records = await _records_for(db_session, provider)
        assert [r.external_record_id for r in records] == ["T-1", "T-2"]
        assert {r.user_id for r in records} == {member.id}
        assert records[0].hours_completed == 1.0
        assert records[0].completion_date == date(2026, 9, 1)
        assert (await _staged(db_session, provider, "T-1")).import_status == (
            "imported"
        )
        waiting = await _staged(db_session, provider, "T-3")
        assert waiting.import_status == "pending"
        assert waiting.user_id is None

    async def test_upload_is_in_the_sync_history(self, db_session):
        _, member, provider = await _setup(db_session)

        response = await upload_report(
            uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
        )

        log = (
            await db_session.execute(
                select(ExternalTrainingSyncLog).where(
                    ExternalTrainingSyncLog.id == str(response.sync_log_id)
                )
            )
        ).scalar_one()
        assert log.sync_type == UPLOAD_SYNC_TYPE
        assert log.initiated_by == member.id
        assert log.sync_from_date == date(2026, 9, 1)
        assert log.records_fetched == 1


@pytest.mark.integration
class TestNoDuplicates:
    async def test_same_file_twice_adds_nothing_the_second_time(self, db_session):
        _, member, provider = await _setup(db_session)
        report = _report(MATCHED, UNMATCHED)

        await upload_report(uuid.UUID(provider.id), _upload(report), db_session, member)
        again = await upload_report(
            uuid.UUID(provider.id), _upload(report), db_session, member
        )

        assert again.new_rows == 0
        assert again.updated_rows == 2
        assert again.training_records_created == 0
        assert len(await _records_for(db_session, provider)) == 1
        assert (
            await _count(db_session, ExternalTrainingImport, provider_id=provider.id)
            == 2
        )

    async def test_api_sync_then_upload(self, db_session):
        _, member, provider = await _setup(db_session)
        provider.api_key = "demo-key"
        provider.api_secret = "demo-secret"
        await db_session.flush()

        # The API credits the matched member straight away.
        service = ExternalTrainingSyncService(db_session)
        await service.http_client.aclose()
        service.http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, content=_report(MATCHED).encode("utf-8")
                )
            )
        )
        try:
            await service.sync_training_records(
                provider, from_date=date(2026, 9, 1), to_date=date(2026, 10, 1)
            )
        finally:
            await service.close()
        assert (await _staged(db_session, provider, "T-1")).import_status == (
            "imported"
        )

        response = await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(MATCHED, MATCHED_2)),
            db_session,
            member,
        )

        assert response.new_rows == 1
        assert response.updated_rows == 1
        # T-1 is already a training record; only T-2 is new.
        assert response.training_records_created == 1
        assert (
            await _count(db_session, ExternalTrainingImport, provider_id=provider.id)
            == 2
        )
        assert len(await _records_for(db_session, provider)) == 2

    async def test_api_sync_credits_matched_members_and_holds_the_rest(
        self, db_session
    ):
        _, member, provider = await _setup(db_session)
        provider.api_key = "demo-key"
        provider.api_secret = "demo-secret"
        await db_session.flush()
        service = ExternalTrainingSyncService(db_session)
        await service.http_client.aclose()
        service.http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, content=_report(MATCHED, UNMATCHED).encode("utf-8")
                )
            )
        )
        try:
            log = await service.sync_training_records(
                provider, from_date=date(2026, 9, 1), to_date=date(2026, 10, 1)
            )
        finally:
            await service.close()

        assert log.records_imported == 2
        (record,) = await _records_for(db_session, provider)
        assert record.user_id == member.id
        assert record.external_record_id == "T-1"
        assert (await _staged(db_session, provider, "T-3")).import_status == ("pending")

    async def _sync_records(self, db_session, provider, records):
        service = ExternalTrainingSyncService(db_session)
        try:
            with patch.object(
                service, "_fetch_external_records", AsyncMock(return_value=records)
            ):
                return await service.sync_training_records(
                    provider, from_date=date(2026, 9, 1), to_date=date(2026, 10, 1)
                )
        finally:
            await service.close()

    @staticmethod
    def _ts_record(row):
        service = ExternalTrainingSyncService(None)
        (parsed,) = ExternalTrainingSyncService._parse_target_solutions_report(
            _report(row), {}
        )
        return service._normalize_target_solutions_record(parsed)

    @pytest.mark.parametrize(
        "provider_type",
        [
            ExternalProviderType.VECTOR_SOLUTIONS,
            ExternalProviderType.LEXIPOL,
            ExternalProviderType.I_AM_RESPONDING,
            ExternalProviderType.CUSTOM_API,
        ],
    )
    async def test_other_providers_keep_the_review_step(
        self, db_session, provider_type
    ):
        _, member, provider = await _setup(db_session, provider_type=provider_type)

        await self._sync_records(db_session, provider, [self._ts_record(MATCHED)])

        staged = await _staged(db_session, provider, "T-1")
        assert staged.user_id == member.id
        assert staged.import_status == "pending"
        assert await _records_for(db_session, provider) == []

    async def test_completions_without_ids_are_not_merged(self, db_session):
        _, member, provider = await _setup(
            db_session, provider_type=ExternalProviderType.LEXIPOL
        )
        service = ExternalTrainingSyncService(None)
        first, second = (
            service._normalize_lexipol_record(
                {
                    "recordId": None,
                    "memberId": None,
                    "memberEmail": "pat@dept.test",
                    "courseId": course,
                    "courseTitle": title,
                    "minutes": 60,
                    "completedDate": "2026-09-15",
                }
            )
            for course, title in (("L-1", "Ethics"), ("L-2", "Harassment"))
        )
        assert first["external_record_id"] == "None"

        log = await self._sync_records(db_session, provider, [first, second])

        assert log.records_imported == 2
        staged = (
            (
                await db_session.execute(
                    select(ExternalTrainingImport).where(
                        ExternalTrainingImport.provider_id == provider.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(r.course_title for r in staged) == ["Ethics", "Harassment"]
        assert {r.user_id for r in staged} == {member.id}
        assert all("None" not in r.external_record_id for r in staged)

    async def test_an_unidentifiable_completion_is_skipped(self, db_session):
        _, _, provider = await _setup(
            db_session, provider_type=ExternalProviderType.LEXIPOL
        )
        nothing = ExternalTrainingSyncService(None)._normalize_lexipol_record(
            {"courseTitle": "Mystery"}
        )

        log = await self._sync_records(db_session, provider, [nothing])

        assert log.records_skipped == 1
        assert (
            await _count(db_session, ExternalTrainingImport, provider_id=provider.id)
            == 0
        )

    async def test_upload_then_api_sync(self, db_session):
        _, member, provider = await _setup(db_session)
        provider.api_key = "demo-key"
        provider.api_secret = "demo-secret"
        await db_session.flush()
        await upload_report(
            uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
        )

        service = ExternalTrainingSyncService(db_session)
        await service.http_client.aclose()
        service.http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, content=_report(MATCHED).encode("utf-8")
                )
            )
        )
        try:
            log = await service.sync_training_records(
                provider, from_date=date(2026, 9, 1), to_date=date(2026, 10, 1)
            )
        finally:
            await service.close()

        assert log.records_imported == 0
        assert log.records_updated == 1
        staged = await _staged(db_session, provider, "T-1")
        assert staged.import_status == "imported"
        assert len(await _records_for(db_session, provider)) == 1

    async def test_existing_training_record_is_linked_not_repeated(self, db_session):
        org, member, provider = await _setup(db_session)
        earlier = TrainingRecord(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            user_id=member.id,
            course_name="Back Injury Prevention",
            training_type=TrainingType.CONTINUING_EDUCATION,
            hours_completed=1.0,
            external_provider_id=provider.id,
            external_record_id="T-1",
        )
        db_session.add(earlier)
        await db_session.flush()

        response = await upload_report(
            uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
        )

        assert response.training_records_created == 0
        assert [r.id for r in await _records_for(db_session, provider)] == [earlier.id]
        staged = await _staged(db_session, provider, "T-1")
        assert staged.training_record_id == earlier.id
        assert staged.import_status == "imported"

    async def test_database_refuses_a_second_staged_row(self, db_session):
        org, _, provider = await _setup(db_session)

        def staged_row():
            return ExternalTrainingImport(
                id=str(uuid.uuid4()),
                provider_id=provider.id,
                organization_id=org.id,
                external_record_id="T-1",
                course_title="Back Injury Prevention",
                import_status="pending",
            )

        db_session.add(staged_row())
        await db_session.flush()
        nested = await db_session.begin_nested()
        db_session.add(staged_row())
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await nested.rollback()


@pytest.mark.integration
class TestUploadIsRefused:
    async def test_another_orgs_provider_is_not_found(self, db_session):
        _, _, provider = await _setup(db_session)
        _, outsider, _ = await _setup(db_session)

        with pytest.raises(HTTPException) as exc:
            await upload_report(
                uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, outsider
            )
        assert exc.value.status_code == 404

    async def test_a_deleted_provider_is_not_found(self, db_session):
        _, member, provider = await _setup(db_session)
        provider.active = False
        await db_session.flush()

        with pytest.raises(HTTPException) as exc:
            await upload_report(
                uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
            )
        assert exc.value.status_code == 404
        assert "inactive" in exc.value.detail

    async def test_other_provider_types(self, db_session):
        _, member, provider = await _setup(
            db_session, provider_type=ExternalProviderType.VECTOR_SOLUTIONS
        )

        with pytest.raises(HTTPException) as exc:
            await upload_report(
                uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
            )
        assert exc.value.status_code == 400
        assert "only available for Target Solutions" in exc.value.detail

    async def test_not_a_csv_file(self, db_session):
        _, member, provider = await _setup(db_session)

        with pytest.raises(HTTPException) as exc:
            await upload_report(
                uuid.UUID(provider.id),
                _upload(_report(MATCHED), filename="report.xlsx"),
                db_session,
                member,
            )
        assert exc.value.status_code == 400

    async def test_a_csv_that_is_not_the_report(self, db_session):
        _, member, provider = await _setup(db_session)

        with pytest.raises(HTTPException) as exc:
            await upload_report(
                uuid.UUID(provider.id),
                _upload("Name,Hours\nPat,2\n"),
                db_session,
                member,
            )
        assert exc.value.status_code == 400
        assert "not a Target Solutions completions report" in exc.value.detail
        assert '"Name,Hours"' in exc.value.detail
        assert await _count(
            db_session, ExternalTrainingSyncLog, provider_id=provider.id
        ) == (0)

    async def test_too_large(self, db_session, monkeypatch):
        _, member, provider = await _setup(db_session)
        monkeypatch.setattr(endpoints, "MAX_REPORT_UPLOAD_BYTES", 100)

        with pytest.raises(HTTPException) as exc:
            await upload_report(
                uuid.UUID(provider.id), _upload(_report(MATCHED)), db_session, member
            )
        assert exc.value.status_code == 413


@pytest.mark.unit
class TestStagingTakesTheProviderLock:
    async def test_provider_row_is_locked_before_any_row_is_staged(self):
        statements = []

        class _Db:
            async def execute(self, statement):
                statements.append(statement)
                return SimpleNamespace(scalar_one_or_none=lambda: None)

        service = ExternalTrainingSyncService(_Db())
        try:
            provider = SimpleNamespace(id="prov-1", organization_id="org-1")
            log = SimpleNamespace(id="log-1")
            await service._stage_records(provider, log, [])
        finally:
            await service.close()

        (lock,) = statements
        assert lock._for_update_arg is not None
        assert "external_training_providers" in str(lock)
        assert log.records_fetched == 0

    def test_upload_parser_names_the_file_not_the_api(self):
        with pytest.raises(ValueError, match="This file is a web page") as exc:
            ExternalTrainingSyncService._parse_target_solutions_report(
                "<html><title>Sign In</title></html>", {}, uploaded=True
            )
        assert 'titled "Sign In"' in str(exc.value)

    def test_upload_of_an_empty_report_stages_nothing(self):
        assert (
            ExternalTrainingSyncService._parse_target_solutions_report(
                "", {}, uploaded=True
            )
            == []
        )


@pytest.mark.integration
class TestPolicyAcknowledgments:
    async def test_admin_rows_are_policy_acknowledgments_with_no_hours(
        self, db_session
    ):
        _, member, provider = await _setup(db_session)

        await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(MATCHED, WHISTLEBLOWER)),
            db_session,
            member,
        )

        by_id = {
            r.external_record_id: r for r in await _records_for(db_session, provider)
        }
        assert by_id["A-3"].training_type == TrainingType.POLICY_ACKNOWLEDGMENT
        assert by_id["A-3"].hours_completed == 0
        assert by_id["T-1"].training_type == TrainingType.CONTINUING_EDUCATION

    async def test_same_day_repeat_is_set_aside(self, db_session):
        _, member, provider = await _setup(db_session)

        response = await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(CONDUCT, CONDUCT_AGAIN, WHISTLEBLOWER)),
            db_session,
            member,
        )

        assert response.training_records_created == 2
        assert "1 same-day repeat acknowledgment(s) set aside" in response.message
        assert [
            r.external_record_id for r in await _records_for(db_session, provider)
        ] == [
            "A-1",
            "A-3",
        ]
        repeat = await _staged(db_session, provider, "A-2")
        assert repeat.import_status == "duplicate"
        assert repeat.import_error == "Same-day repeat of acknowledgment A-1"

    async def test_next_years_acknowledgment_is_kept(self, db_session):
        _, member, provider = await _setup(db_session)

        response = await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(CONDUCT, CONDUCT_NEXT_YEAR)),
            db_session,
            member,
        )

        assert response.training_records_created == 2

    async def test_same_day_repeat_across_two_uploads(self, db_session):
        _, member, provider = await _setup(db_session)
        await upload_report(
            uuid.UUID(provider.id), _upload(_report(CONDUCT)), db_session, member
        )

        response = await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(CONDUCT, CONDUCT_AGAIN)),
            db_session,
            member,
        )

        assert response.training_records_created == 0
        assert (await _staged(db_session, provider, "A-2")).import_status == (
            "duplicate"
        )

    async def test_course_completions_on_one_day_are_not_collapsed(self, db_session):
        _, member, provider = await _setup(db_session)
        twice = _row(
            "1001", "pat@dept.test", "Back Injury Prevention", "9/1/2026", "T-9"
        )

        response = await upload_report(
            uuid.UUID(provider.id),
            _upload(_report(MATCHED, twice)),
            db_session,
            member,
        )

        assert response.training_records_created == 2

    async def test_manual_import_button_uses_the_same_type(self, db_session):
        _, member, provider = await _setup(db_session)
        await upload_report(
            uuid.UUID(provider.id),
            _upload(
                _report(
                    _admin_row(
                        "9999",
                        "nobody@else.test",
                        "FCVFD Code of Conduct",
                        "1472902",
                        "9/25/2026",
                        "12:17 AM",
                        "A-9",
                    )
                )
            ),
            db_session,
            member,
        )
        staged = await _staged(db_session, provider, "A-9")

        await import_single_record(
            uuid.UUID(provider.id),
            uuid.UUID(staged.id),
            ImportRecordRequest(
                external_import_id=uuid.UUID(staged.id), user_id=uuid.UUID(member.id)
            ),
            db_session,
            member,
        )

        (record,) = await _records_for(db_session, provider)
        assert record.training_type == TrainingType.POLICY_ACKNOWLEDGMENT


@pytest.mark.unit
class TestPolicyAcknowledgmentType:
    @pytest.mark.parametrize("value", ["Admin", "admin", " ADMIN "])
    def test_admin_assignment_type_maps_to_policy_acknowledgment(self, value):
        assert (
            ExternalTrainingSyncService._map_training_type({"Assignment Type": value})
            == TrainingType.POLICY_ACKNOWLEDGMENT
        )

    def test_ts_course_is_not_an_acknowledgment(self):
        assert (
            ExternalTrainingSyncService._map_training_type(
                {"Assignment Type": "TS Course"}
            )
            == TrainingType.CONTINUING_EDUCATION
        )

    def test_csv_import_accepts_the_new_type(self):
        assert "policy_acknowledgment" in VALID_TRAINING_TYPES
        assert VALID_TRAINING_TYPES == {t.value for t in TrainingType}
