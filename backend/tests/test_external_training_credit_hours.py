"""
Credit hours for an imported completion come from the provider's credit value.

For Target Solutions that is the report's "Duration (hours)" column: the hours
a course is accredited for. "Time Spent In Course" is how long the member had
it open, which can run well past the accredited hours, and must never become
the credit. Sync already staged the right value, but the officer's Import and
Bulk Import buttons rebuilt hours from minutes and dropped ``credit_hours``, so
a manual import could credit something different from an automatic one.
"""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app.api.v1.endpoints.external_training import (
    bulk_import_records,
    import_single_record,
)
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    TrainingRecord,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training import BulkImportRequest, ImportRecordRequest
from app.services.external_training_service import (
    ExternalTrainingSyncService,
    credited_hours,
)

HEADER = (
    "Employee ID,Email,Assignment Name,Assignment Type,Assigned By,Date Assigned,"
    "Date Due,Completion Date,Completion Time,Time Spent In Course,Test Score,"
    "Test Attempts,Tags,Course ID,Transcript ID,RMS Code,Duration (hours),"
    "Instructor,Location"
)


@pytest.mark.unit
class TestCreditedHours:
    def test_credit_hours_win_over_minutes(self):
        row = SimpleNamespace(credit_hours=1.0, duration_minutes=103)
        assert credited_hours(row) == 1.0

    def test_minutes_are_the_fallback(self):
        row = SimpleNamespace(credit_hours=None, duration_minutes=90)
        assert credited_hours(row) == 1.5

    def test_no_credit_and_no_minutes_is_zero(self):
        row = SimpleNamespace(credit_hours=None, duration_minutes=None)
        assert credited_hours(row) == 0

    def test_fractional_credit_is_kept_to_two_places(self):
        row = SimpleNamespace(credit_hours=0.333, duration_minutes=20)
        assert credited_hours(row) == 0.33


@pytest.mark.unit
class TestTargetSolutionsHoursColumn:
    async def _records(self, *rows):
        body = "\n".join([HEADER, *rows]) + "\n"
        service = ExternalTrainingSyncService(None)
        await service.http_client.aclose()
        service.http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, content=body.encode())
            )
        )
        provider = ExternalTrainingProvider(
            id="prov-1",
            organization_id="org-1",
            name="Target Solutions",
            provider_type=ExternalProviderType.TARGET_SOLUTIONS,
            api_base_url="https://app.targetsolutions.com/tsapp/api/",
            api_key="key",
            api_secret="secret",
            auth_type="api_key",
        )
        try:
            return await service._fetch_external_records(
                provider, date(2026, 9, 1), date(2026, 10, 1)
            )
        finally:
            await service.close()

    async def test_duration_is_the_credit_not_time_spent(self):
        # 103 minutes in the course, accredited for one hour.
        (record,) = await self._records(
            "1001,member@dept.test,CAPCE Course,TS Course,,9/28/2026,,9/28/2026,"
            "2:54 PM,103,95%,1,,2272607,562245750,,1,,"
        )
        assert record["credit_hours"] == 1.0
        assert record["duration_minutes"] == 60

    async def test_blank_duration_credits_nothing(self):
        (record,) = await self._records(
            "1001,member@dept.test,Code of Conduct,Admin,,9/24/2026,,9/25/2026,"
            "12:17 AM,45,Completed,,,1472902,561939704,,,,"
        )
        assert record["credit_hours"] is None
        assert record["duration_minutes"] is None


async def _setup(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Credit Hours Department",
        slug=f"ch-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u{uuid.uuid4().hex[:10]}",
        email=f"{uuid.uuid4().hex[:8]}@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(member)
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Target Solutions",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
        api_base_url="https://app.targetsolutions.com/tsapp/api/",
    )
    db_session.add(provider)
    await db_session.flush()
    return member, provider, member


async def _staged(db_session, provider, user_id=None):
    # Matches what sync stages for a one-credit-hour course the member spent
    # 103 minutes in: credit_hours from "Duration (hours)", minutes from it too.
    row = ExternalTrainingImport(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=provider.organization_id,
        external_record_id=f"R-{uuid.uuid4().hex[:8]}",
        external_user_id="1001",
        course_title="CAPCE Complementary and Alternative Medicine",
        completion_date=datetime(2026, 9, 28, tzinfo=timezone.utc),
        credit_hours=1.0,
        duration_minutes=60,
        raw_data={"Time Spent In Course": "103", "Duration (hours)": "1"},
        import_status="pending",
        user_id=user_id,
    )
    db_session.add(row)
    await db_session.flush()
    return row


async def _training_record(db_session, staged):
    return (
        await db_session.execute(
            select(TrainingRecord).where(TrainingRecord.id == staged.training_record_id)
        )
    ).scalar_one()


@pytest.mark.integration
class TestManualImportCreditsDurationHours:
    async def test_single_import(self, db_session):
        member, provider, caller = await _setup(db_session)
        staged = await _staged(db_session, provider)

        await import_single_record(
            uuid.UUID(provider.id),
            uuid.UUID(staged.id),
            ImportRecordRequest(
                external_import_id=uuid.UUID(staged.id),
                user_id=uuid.UUID(member.id),
            ),
            db_session,
            caller,
        )

        record = await _training_record(db_session, staged)
        assert record.hours_completed == 1.0
        assert record.credit_hours == 1.0

    async def test_bulk_import(self, db_session):
        member, provider, caller = await _setup(db_session)
        staged = await _staged(db_session, provider, user_id=member.id)

        response = await bulk_import_records(
            uuid.UUID(provider.id),
            BulkImportRequest(external_import_ids=[uuid.UUID(staged.id)]),
            db_session,
            caller,
        )

        assert response.imported == 1
        record = await _training_record(db_session, staged)
        assert record.hours_completed == 1.0
        assert record.credit_hours == 1.0
