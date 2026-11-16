"""
Every training list says where a record came from.

A provider sync reads as the provider ("Target Solutions"), the Historical Data
Import as "Imported", and anything else as "The Logbook". The records list,
the member's own history and the individual CSV and PDF exports all read the
label from ``record_sources``, so they cannot disagree.
"""

import csv
import io
import uuid
from datetime import date
from unittest.mock import AsyncMock

import pytest
from fastapi import Response, UploadFile
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training import (
    MAX_TRAINING_RECORDS_PAGE,
    confirm_historical_import,
    import_training_csv,
    list_records,
)
from app.api.v1.endpoints.training_module_config import get_my_training_records
from app.models.historical_import import ImportedRecordKind, ImportedSourceRecord
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingProvider,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training import (
    HistoricalImportConfirmRequest,
    HistoricalImportParsedRow,
)
from app.services.training_enhancement_service import ReportExportService
from app.services.training_record_source import (
    CSV_IMPORT_SOURCE_SYSTEM,
    record_sources,
)

pytestmark = [pytest.mark.integration]


async def _member(db_session, org_id) -> User:
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        username=f"m{uuid.uuid4().hex[:10]}",
        email=f"{uuid.uuid4().hex[:8]}@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(member)
    await db_session.flush()
    result = await db_session.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(User.id == member.id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _provider(
    db_session, org_id, provider_type, name
) -> ExternalTrainingProvider:
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name=name,
        provider_type=provider_type,
    )
    db_session.add(provider)
    await db_session.flush()
    return provider


async def _record(db_session, org_id, user_id, name, day, **extra) -> TrainingRecord:
    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user_id,
        course_name=name,
        training_type=TrainingType.CONTINUING_EDUCATION,
        completion_date=day,
        hours_completed=2,
        status=TrainingStatus.COMPLETED,
        **extra,
    )
    db_session.add(record)
    await db_session.flush()
    return record


async def _ledger(
    db_session, org_id, record_id, kind=ImportedRecordKind.TRAINING_RECORD
):
    db_session.add(
        ImportedSourceRecord(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            source_system="Hours database",
            source_id=f"row-{uuid.uuid4().hex[:8]}",
            record_kind=kind.value,
            record_id=record_id,
        )
    )
    await db_session.flush()


async def _one_of_each(db_session, org_id, member):
    """A synced, an imported and a hand-entered record, newest first."""
    ts = await _provider(
        db_session, org_id, ExternalProviderType.TARGET_SOLUTIONS, "FCVFD TS feed"
    )
    synced = await _record(
        db_session,
        org_id,
        member.id,
        "Synced class",
        date(2024, 3, 1),
        external_provider_id=ts.id,
        external_record_id="ts-1",
    )
    imported = await _record(
        db_session, org_id, member.id, "Imported class", date(2024, 2, 1)
    )
    await _ledger(db_session, org_id, imported.id)
    entered = await _record(
        db_session, org_id, member.id, "Entered class", date(2024, 1, 1)
    )
    return synced, imported, entered


class TestRecordSources:
    async def test_each_origin_gets_its_label(self, db_session, setup_org_and_admin):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        synced, imported, entered = await _one_of_each(db_session, org_id, member)

        sources = await record_sources(db_session, org_id, [synced, imported, entered])

        assert [
            (sources[r.id].kind, sources[r.id].label)
            for r in (synced, imported, entered)
        ] == [
            ("provider", "Target Solutions"),
            ("imported", "Imported"),
            ("logbook", "The Logbook"),
        ]

    async def test_a_custom_connection_reads_as_its_own_name(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        custom = await _provider(
            db_session, org_id, ExternalProviderType.CUSTOM_API, "County LMS"
        )
        record = await _record(
            db_session,
            org_id,
            member.id,
            "LMS class",
            date(2024, 1, 1),
            external_provider_id=custom.id,
            external_record_id="lms-1",
        )

        sources = await record_sources(db_session, org_id, [record])

        assert sources[record.id].label == "County LMS"

    async def test_a_sync_whose_connection_was_deleted_still_reads_as_a_provider(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        # The provider's foreign key is SET NULL; its record id survives.
        record = await _record(
            db_session,
            org_id,
            member.id,
            "Orphaned sync",
            date(2024, 1, 1),
            external_record_id="ts-gone",
        )

        sources = await record_sources(db_session, org_id, [record])

        assert (sources[record.id].kind, sources[record.id].label) == (
            "provider",
            "Training provider",
        )

    async def test_another_kind_of_ledger_entry_is_not_an_import(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        record = await _record(
            db_session, org_id, member.id, "Entered class", date(2024, 1, 1)
        )
        # The ledger points into whichever table record_kind names; an id
        # under another kind is a different row that happens to share it.
        await _ledger(
            db_session, org_id, record.id, ImportedRecordKind.TRAINING_SESSION
        )

        sources = await record_sources(db_session, org_id, [record])

        assert sources[record.id].label == "The Logbook"

    async def test_another_departments_ledger_does_not_count(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        other = Organization(
            id=str(uuid.uuid4()),
            name="Other Department",
            slug=f"other-{uuid.uuid4().hex[:8]}",
        )
        db_session.add(other)
        await db_session.flush()
        member = await _member(db_session, org_id)
        record = await _record(
            db_session, org_id, member.id, "Entered class", date(2024, 1, 1)
        )
        await _ledger(db_session, other.id, record.id)

        sources = await record_sources(db_session, org_id, [record])

        assert sources[record.id].label == "The Logbook"


class TestScreensAndExports:
    async def test_the_records_list_carries_the_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        await _one_of_each(db_session, org_id, member)

        rows = await list_records(
            response=Response(),
            user_id=None,
            status=None,
            start_date=None,
            end_date=None,
            skip=0,
            limit=MAX_TRAINING_RECORDS_PAGE,
            db=db_session,
            current_user=member,
        )

        assert [(r.course_name, r.source, r.source_label) for r in rows] == [
            ("Synced class", "provider", "Target Solutions"),
            ("Imported class", "imported", "Imported"),
            ("Entered class", "logbook", "The Logbook"),
        ]

    async def test_my_training_history_carries_the_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        await _one_of_each(db_session, org_id, member)

        page = await get_my_training_records(
            year=None,
            search=None,
            training_type=None,
            page=1,
            page_size=25,
            db=db_session,
            current_user=member,
        )

        assert [
            (i["course_name"], i["source"], i["source_label"]) for i in page["items"]
        ] == [
            ("Synced class", "provider", "Target Solutions"),
            ("Imported class", "imported", "Imported"),
            ("Entered class", "logbook", "The Logbook"),
        ]

    async def test_the_csv_export_adds_source_as_its_last_column(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        await _one_of_each(db_session, org_id, member)

        content = await ReportExportService(db_session).generate_individual_csv(
            member.id, org_id, end_date=date(2024, 12, 31)
        )
        rows = list(csv.reader(io.StringIO(content)))

        assert rows[0][-2:] == ["Location", "Source"]
        assert [(r[0], r[-1]) for r in rows[1:]] == [
            ("Synced class", "Target Solutions"),
            ("Imported class", "Imported"),
            ("Entered class", "The Logbook"),
        ]

    async def test_the_pdf_rows_carry_the_source(self, db_session, setup_org_and_admin):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        records = list(await _one_of_each(db_session, org_id, member))

        rows = ReportExportService._individual_rows(
            records, await record_sources(db_session, org_id, records)
        )

        assert [r["source"] for r in rows] == [
            "Target Solutions",
            "Imported",
            "The Logbook",
        ]

    async def test_the_pdf_prints_the_source_under_each_course(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        member = await _member(db_session, org_id)
        await _one_of_each(db_session, org_id, member)

        pdf = await ReportExportService(db_session).generate_individual_pdf(
            member.id, org_id, end_date=date(2024, 12, 31)
        )
        text = " ".join(
            " ".join((page.extract_text() or "").split())
            for page in PdfReader(io.BytesIO(pdf.getvalue())).pages
        )

        assert "Course / Source" in text
        for course, label in (
            ("Synced class", "Target Solutions"),
            ("Imported class", "Imported"),
            ("Entered class", "The Logbook"),
        ):
            assert f"{course} {label}" in text


async def _all_records(db_session, member):
    result = await db_session.execute(
        select(TrainingRecord)
        .where(TrainingRecord.user_id == member.id)
        .order_by(TrainingRecord.course_name)
    )
    return list(result.scalars().all())


async def _ledger_for(db_session, record_ids):
    result = await db_session.execute(
        select(ImportedSourceRecord).where(
            ImportedSourceRecord.record_id.in_(record_ids)
        )
    )
    return list(result.scalars().all())


@pytest.fixture
def _no_side_effects(monkeypatch):
    """The importers' own scanning, audit and qualification sync are not
    what these tests are about, and need services a test database lacks."""
    monkeypatch.setattr(training_endpoints, "reject_if_malicious", AsyncMock())
    monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
    monkeypatch.setattr(training_endpoints, "_sync_qualifications", AsyncMock())


@pytest.mark.usefixtures("_no_side_effects")
class TestTrainingCsvImportersAreLedgered:
    async def test_the_import_wizard_marks_what_it_writes_as_imported(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        request = HistoricalImportConfirmRequest(
            rows=[
                HistoricalImportParsedRow(
                    row_number=n,
                    user_id=member.id,
                    member_matched=True,
                    course_name=name,
                    completion_date=date(2019, 5, n),
                    hours_completed=2,
                )
                for n, name in ((1, "Wizard class A"), (2, "Wizard class B"))
            ]
        )

        result = await confirm_historical_import(
            request=request, db=db_session, current_user=officer
        )
        records = await _all_records(db_session, member)
        sources = await record_sources(db_session, org_id, records)
        ledger = await _ledger_for(db_session, [r.id for r in records])

        assert result.imported == 2
        assert [sources[r.id].label for r in records] == ["Imported", "Imported"]
        assert sorted((e.source_system, e.source_id) for e in ledger) == sorted(
            (CSV_IMPORT_SOURCE_SYSTEM, r.id) for r in records
        )

    async def test_the_csv_upload_marks_what_it_writes_as_imported(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        officer = await _member(db_session, org_id)
        member = await _member(db_session, org_id)
        content = (
            "memberEmail,courseName,trainingType,completionDate,hoursCompleted\n"
            f"{member.email},Upload class,continuing_education,2019-05-01,2\n"
        ).encode()

        result = await import_training_csv(
            file=UploadFile(file=io.BytesIO(content), filename="history.csv"),
            db=db_session,
            current_user=officer,
        )
        records = await _all_records(db_session, member)
        sources = await record_sources(db_session, org_id, records)

        assert result["success"] == 1
        assert [(r.course_name, sources[r.id].label) for r in records] == [
            ("Upload class", "Imported")
        ]
