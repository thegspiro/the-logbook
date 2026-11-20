"""
The Source column on every export whose rows can be told apart.

Owner decision 2026-11-16: training records say their provider, "Imported" or
"The Logbook"; Admin Hours entries, events and event check-ins say "Imported"
or "The Logbook". These pin each export that gained the column, and the list
fields the browser-built event and check-in CSVs read.
"""

import csv
import io
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.api.v1.endpoints.events import _list_items
from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
)
from app.models.historical_import import ImportedRecordKind, ImportedSourceRecord
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingProvider,
    TrainingRecord,
    TrainingSession,
    TrainingStatus,
    TrainingType,
)
from app.models.user import User
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import EventService
from app.services.import_provenance import imported_record_ids
from app.services.reports_service import ReportsService
from app.services.training_enhancement_service import ReportExportService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


def _rows(content: str):
    return list(csv.reader(io.StringIO(content)))


async def _ledger(db, org_id, kind, record_id):
    db.add(
        ImportedSourceRecord(
            organization_id=org_id,
            source_system="Hours database",
            source_id=f"row-{uuid.uuid4().hex[:10]}",
            record_kind=kind.value,
            record_id=record_id,
        )
    )
    await db.flush()


async def _member(db, org_id) -> User:
    return (
        await db.execute(select(User).where(User.organization_id == org_id).limit(1))
    ).scalar_one()


async def _training(db, org_id):
    """A synced, an imported and an entered certification, newest first."""
    member = await _member(db, org_id)
    ts = ExternalTrainingProvider(
        id=_uid(),
        organization_id=org_id,
        name="Department TS feed",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
    )
    db.add(ts)
    made = []
    for name, day, extra in (
        ("Synced cert", date(2024, 3, 1), {"external_provider_id": ts.id}),
        ("Imported cert", date(2024, 2, 1), {}),
        ("Entered cert", date(2024, 1, 1), {}),
    ):
        record = TrainingRecord(
            id=_uid(),
            organization_id=org_id,
            user_id=member.id,
            course_name=name,
            training_type=TrainingType.CERTIFICATION,
            completion_date=day,
            expiration_date=day + timedelta(days=730),
            certification_number=f"N-{name[:3]}",
            hours_completed=2,
            status=TrainingStatus.COMPLETED,
            **extra,
        )
        db.add(record)
        made.append(record)
    await db.flush()
    await _ledger(db, org_id, ImportedRecordKind.TRAINING_RECORD, made[1].id)
    return member, made


EXPECTED_TRAINING = {
    "Synced cert": "Target Solutions",
    "Imported cert": "Imported",
    "Entered cert": "The Logbook",
}


class TestTrainingExports:
    async def test_the_all_members_csv_ends_with_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        await _training(db_session, org_id)

        rows = _rows(
            await ReportExportService(db_session).generate_bulk_csv(
                org_id, end_date=date(2024, 12, 31)
            )
        )

        assert rows[0][-2:] == ["Location", "Source"]
        found = {r[2]: r[-1] for r in rows[1:]}
        assert {k: found[k] for k in EXPECTED_TRAINING} == EXPECTED_TRAINING

    async def test_the_certification_csv_ends_with_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        await _training(db_session, org_id)

        rows = _rows(
            await ReportExportService(db_session).generate_certification_csv(
                org_id, end_date=date(2024, 12, 31)
            )
        )

        assert rows[0][-2:] == ["Days Until Expiry", "Source"]
        found = {r[2]: r[-1] for r in rows[1:]}
        assert {k: found[k] for k in EXPECTED_TRAINING} == EXPECTED_TRAINING

    async def test_the_certification_expiration_report_carries_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        await _training(db_session, org_id)

        report = await ReportsService(db_session)._generate_certification_expiration(
            uuid.UUID(org_id)
        )

        found = {e["course_name"]: e["source"] for e in report["entries"]}
        assert {k: found.get(k) for k in EXPECTED_TRAINING} == EXPECTED_TRAINING


async def _admin_entries(db, org_id):
    member = await _member(db, org_id)
    category = AdminHoursCategory(id=_uid(), organization_id=org_id, name="Admin")
    db.add(category)
    start = datetime(2024, 5, 1, 18, tzinfo=timezone.utc)
    for method, minutes in (
        (AdminHoursEntryMethod.IMPORT, 60),
        (AdminHoursEntryMethod.MANUAL, 30),
    ):
        db.add(
            AdminHoursEntry(
                id=_uid(),
                organization_id=org_id,
                user_id=member.id,
                category_id=category.id,
                clock_in_at=start,
                clock_out_at=start + timedelta(minutes=minutes),
                duration_minutes=minutes,
                entry_method=method,
                status=AdminHoursEntryStatus.APPROVED,
            )
        )
    await db.flush()


class TestAdminHoursExports:
    async def test_the_entries_csv_ends_with_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        await _admin_entries(db_session, org_id)

        rows = _rows(await AdminHoursService(db_session).export_entries_csv(org_id))

        assert rows[0][-3:] == ["Approved By", "Description", "Source"]
        assert sorted((r[6], r[-1]) for r in rows[1:]) == [
            ("import", "Imported"),
            ("manual", "The Logbook"),
        ]

    async def test_the_admin_hours_report_carries_source(
        self, db_session, setup_org_and_admin
    ):
        org_id, _admin = setup_org_and_admin
        await _admin_entries(db_session, org_id)

        report = await ReportsService(db_session)._generate_admin_hours(
            uuid.UUID(org_id)
        )

        assert sorted((e["entry_method"], e["source"]) for e in report["entries"]) == [
            ("import", "Imported"),
            ("manual", "The Logbook"),
        ]


async def _event(db, org_id, title) -> str:
    event_id = _uid()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    await db.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule) "
            "VALUES (:id, :org, :title, 'training', :start, :end, 1, 0, 0, 0, "
            "'[24]')"
        ),
        {
            "id": event_id,
            "org": org_id,
            "title": title,
            "start": start,
            "end": start + timedelta(hours=2),
        },
    )
    await db.flush()
    return event_id


class TestEventsAndCheckIns:
    async def test_the_events_list_says_which_an_import_wrote(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        roster = await _event(db_session, org_id, "Roster event")
        drill = await _event(db_session, org_id, "Drill event")
        await _event(db_session, org_id, "Entered event")
        await _ledger(db_session, org_id, ImportedRecordKind.EVENT, roster)
        session = TrainingSession(
            id=_uid(),
            organization_id=org_id,
            event_id=drill,
            course_name="Company drill",
            training_type=TrainingType.CONTINUING_EDUCATION,
            credit_hours=2,
        )
        db_session.add(session)
        await db_session.flush()
        await _ledger(
            db_session, org_id, ImportedRecordKind.TRAINING_SESSION, session.id
        )

        rows = await EventService(db_session).list_events(
            organization_id=uuid.UUID(org_id), user_id=uuid.UUID(admin_id)
        )
        items = await _list_items(db_session, org_id, rows)

        assert {i.title: (i.source, i.source_label) for i in items} == {
            "Roster event": ("imported", "Imported"),
            "Drill event": ("imported", "Imported"),
            "Entered event": ("logbook", "The Logbook"),
        }

    async def test_a_check_in_the_import_wrote_is_found(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        event_id = await _event(db_session, org_id, "Roster event")
        rsvp_ids = []
        for _ in range(2):
            rsvp_id = _uid()
            member_id = _uid()
            await db_session.execute(
                text(
                    "INSERT INTO users (id, organization_id, username, first_name, "
                    "last_name, email, password_hash, status) VALUES (:id, :org, "
                    ":un, 'A', 'B', :em, 'x', 'active')"
                ),
                {
                    "id": member_id,
                    "org": org_id,
                    "un": f"u{member_id[:8]}",
                    "em": f"{member_id[:8]}@t.test",
                },
            )
            await db_session.execute(
                text(
                    "INSERT INTO event_rsvps (id, organization_id, event_id, user_id, "
                    "status, guest_count, responded_at) VALUES (:id, :org, :ev, :u, "
                    "'going', 0, :at)"
                ),
                {
                    "id": rsvp_id,
                    "org": org_id,
                    "ev": event_id,
                    "u": member_id,
                    "at": datetime.now(timezone.utc),
                },
            )
            rsvp_ids.append(rsvp_id)
        await _ledger(db_session, org_id, ImportedRecordKind.EVENT_RSVP, rsvp_ids[0])

        found = await imported_record_ids(
            db_session, org_id, ImportedRecordKind.EVENT_RSVP, rsvp_ids
        )

        assert found == {rsvp_ids[0]}
