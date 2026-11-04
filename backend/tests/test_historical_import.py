"""Historical data import against the database.

The routing rules are covered without a database in
``test_historical_import_engine.py`` and the shift review rules in
``test_shift_history_import_engine.py``. These pin what only the database can
show:

* **An upload writes nothing but itself**, and is reached only from its own
  organization.
* **A committed batch writes what the department asked for** — on-call shifts
  marked on call, credited by recorded hours, calls filed by type — and enters
  every row in the ledger.
* **Running it twice writes nothing twice** (pitfall #36): a re-route leaves
  committed rows out, a second draft carrying a committed row skips it, and two
  commits racing on one row collide on the ledger's unique key.
* **Only the IT administrator holds the permission** by default.
"""

import json
import uuid
from typing import Tuple

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import DEFAULT_POSITIONS
from app.models.call_tracking import CallSource, OrgCall, OrgCallResponse
from app.models.external_shift_hours import ExternalShiftHours
from app.models.historical_import import HistoricalImportRow, ImportedSourceRecord
from app.models.shift_history_import import ShiftHistoryImport, ShiftHistoryImportRow
from app.models.training import BasicApparatus, Shift, ShiftAttendance
from app.services.historical_import_service import (
    HistoricalImportLocked,
    HistoricalImportNotFound,
    HistoricalImportService,
)
from app.services.shift_history_import_service import (
    ImportNotReady,
    ShiftHistoryImportService,
)

pytestmark = pytest.mark.integration

HEADER = (
    "VID,Date,Start,End,Standby,Training,Admin,PubEd,Recall,UniqueID,"
    "EMSCalls,FireCalls,UnitStaffed"
)
CSV = "\n".join(
    [
        HEADER,
        # In-station crew on the ladder, with calls.
        "101,2015-11-14 00:00:00.000,0645,1845,12.0,,,,,9001,2,1,LA106",
        "102,2015-11-14 00:00:00.000,0645,1845,12.0,,,,,9002,2,0,LA106",
        # The same day on call from home, same unit: a different shift.
        "101,2015-11-14 00:00:00.000,1900,0700,,,,,12.0,9003,,,LA106",
        # A 24-hour shift written 0800-0800.
        "102,2015-12-01 00:00:00.000,0800,0800,24.0,,,,,9004,0,0,LA106",
        # Mutual aid on another department's unit.
        "101,2015-12-02 00:00:00.000,0800,1200,4.0,,,,,9005,1,0,E116",
        # Training and admin route but are not sent anywhere yet.
        "101,2015-12-03 00:00:00.000,1900,2100,,2.0,,,,9006,,,",
        "102,2015-12-04 00:00:00.000,1900,2000,,,1.0,,,9007,,,",
        # No hours at all.
        "102,2015-12-05 00:00:00.000,1900,2000,0.0,,,,,9008,,,",
    ]
)


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db: AsyncSession, name: str = "Hist FD") -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'America/New_York', "
            ":settings)"
        ),
        {
            "id": org_id,
            "name": name,
            "slug": f"hist-{org_id[:8]}",
            "settings": json.dumps({}),
        },
    )
    return org_id


async def _add_user(
    db: AsyncSession, org_id: str, first: str, last: str, number: str
) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, membership_number) VALUES "
            "(:id, :org, :un, :fn, :ln, :em, 'hashed', 'active', :num)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:6]}",
            "fn": first,
            "ln": last,
            "em": f"{user_id[:8]}@fd.test",
            "num": number,
        },
    )
    return user_id


async def _world(db: AsyncSession) -> Tuple[str, str]:
    org = await _add_org(db)
    admin = await _add_user(db, org, "Ida", "Admin", "1")
    await _add_user(db, org, "Alice", "Ng", "101")
    await _add_user(db, org, "Bob", "Diaz", "102")
    db.add(
        BasicApparatus(
            id=_uid(),
            organization_id=org,
            unit_number="LA106",
            name="Ladder 106",
            positions=[
                {"position": "driver", "required": True},
                {"position": "firefighter", "required": False},
            ],
        )
    )
    await db.commit()
    return org, admin


async def _upload(db: AsyncSession, org: str, admin: str):
    return await HistoricalImportService(db).create(
        org, admin, "FCVFDHours.csv", CSV, "FCVFD Hours DB", None
    )


async def _commit_all_batches(db: AsyncSession, org: str, admin: str, record_id: str):
    service = HistoricalImportService(db)
    shifts = ShiftHistoryImportService(db)
    batches = await service.create_shift_batches(org, record_id, admin)
    for batch in batches:
        draft = await shifts.get_draft(org, batch.id)
        await shifts.update_mappings(
            draft,
            units={
                "|e116": {
                    "action": "create_external",
                    "agency_name": "County",
                    "unit_name": "E116",
                }
            },
        )
        await shifts.commit(org, batch.id, admin)
    return batches


class TestUpload:
    async def test_upload_reads_the_export_and_writes_nothing_else(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)

        assert record.row_count == 8
        assert record.column_mapping["membership_number"] == "VID"
        assert record.column_mapping["unit"] == "UnitStaffed"
        assert record.hour_columns["Recall"] == "on_call"
        assert record.call_columns == {"EMSCalls": "ems", "FireCalls": "fire"}
        rows = (
            await db_session.execute(
                select(func.count(HistoricalImportRow.id)).where(
                    HistoricalImportRow.import_id == record.id
                )
            )
        ).scalar()
        assert rows == 8
        shifts = (
            await db_session.execute(
                select(func.count(Shift.id)).where(Shift.organization_id == org)
            )
        ).scalar()
        assert shifts == 0

        detail = await HistoricalImportService(db_session).detail(record)
        types = detail["routing"]["types"]
        assert types["shift"]["records"] == 4
        assert types["on_call"]["records"] == 1
        assert types["training"]["records"] == 1
        assert types["admin"]["records"] == 1
        assert detail["routing"]["skipped"] == 1

    async def test_another_department_cannot_reach_it(self, db_session):
        org, admin = await _world(db_session)
        other = await _add_org(db_session, "Other FD")
        record = await _upload(db_session, org, admin)
        with pytest.raises(HistoricalImportNotFound):
            await HistoricalImportService(db_session).get(other, record.id)


class TestShiftBatches:
    async def test_settings_are_locked_while_a_batch_is_in_review(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        service = HistoricalImportService(db_session)
        await service.create_shift_batches(org, record.id, admin)

        with pytest.raises(HistoricalImportLocked):
            await service.update_settings(
                await service.get(org, record.id), timezone_name="America/Chicago"
            )
        assert await service.discard_open_batches(org, record.id) == 1
        await service.update_settings(
            await service.get(org, record.id), timezone_name="America/Chicago"
        )

    async def test_a_committed_batch_writes_what_was_asked(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        await _commit_all_batches(db_session, org, admin, record.id)

        shifts = (
            (
                await db_session.execute(
                    select(Shift).where(Shift.organization_id == org)
                )
            )
            .scalars()
            .all()
        )
        assert sorted(s.duty_type for s in shifts) == [
            "in_station",
            "in_station",
            "on_call",
        ]
        on_call = next(s for s in shifts if s.duty_type == "on_call")
        assert on_call.shift_date.isoformat() == "2015-11-14"

        minutes = (
            (
                await db_session.execute(
                    select(ShiftAttendance.duration_minutes)
                    .join(Shift, Shift.id == ShiftAttendance.shift_id)
                    .where(Shift.organization_id == org)
                )
            )
            .scalars()
            .all()
        )
        # Two 12-hour crew members, a 12-hour recall, and the 24-hour shift
        # written 0800-0800 — credited by its recorded hours.
        assert sorted(minutes) == [720, 720, 720, 1440]

        crew_shift = next(
            s for s in shifts if s.duty_type == "in_station" and s.shift_date.day == 14
        )
        calls = (
            await db_session.execute(
                select(OrgCall.call_type, OrgCall.source, func.count())
                .join(OrgCallResponse, OrgCallResponse.call_id == OrgCall.id)
                .where(OrgCallResponse.shift_id == crew_shift.id)
                .group_by(OrgCall.call_type, OrgCall.source)
            )
        ).all()
        # Most any one member logged, per type: 2 EMS and 1 fire, not 4 and 1.
        assert sorted(calls) == [
            ("ems", CallSource.IMPORT, 2),
            ("fire", CallSource.IMPORT, 1),
        ]
        assert crew_shift.call_count == 3

        external = (
            await db_session.execute(
                select(ExternalShiftHours).where(
                    ExternalShiftHours.organization_id == org
                )
            )
        ).scalar_one()
        assert external.call_count == 1
        assert external.duration_minutes == 240

        ledger = (
            (
                await db_session.execute(
                    select(ImportedSourceRecord.source_id).where(
                        ImportedSourceRecord.organization_id == org
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(ledger) == ["9001", "9002", "9003", "9004", "9005"]

        outcomes = (
            (
                await db_session.execute(
                    select(ShiftHistoryImportRow.outcome)
                    .join(
                        ShiftHistoryImport,
                        ShiftHistoryImport.id == ShiftHistoryImportRow.import_id,
                    )
                    .where(ShiftHistoryImport.historical_import_id == record.id)
                )
            )
            .scalars()
            .all()
        )
        assert set(outcomes) == {"imported"}

    async def test_the_log_reports_where_every_row_stands(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        await _commit_all_batches(db_session, org, admin, record.id)
        service = HistoricalImportService(db_session)
        lines = list(await service.log_rows(await service.get(org, record.id)))
        by_id = {line[1]: line for line in lines[1:] if line[1]}

        assert lines[0][5] == "outcome"
        assert by_id["9001"][5] == "imported"
        assert by_id["9006"][5] == "waiting"
        assert by_id["9007"][5] == "waiting"
        assert any(line[5] == "skipped" for line in lines[1:])


class TestRunningTwice:
    async def test_routing_again_leaves_committed_rows_out(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        await _commit_all_batches(db_session, org, admin, record.id)

        with pytest.raises(ValueError, match="already been imported"):
            await HistoricalImportService(db_session).create_shift_batches(
                org, record.id, admin
            )

    async def test_the_same_file_uploaded_again_imports_nothing_new(self, db_session):
        org, admin = await _world(db_session)
        first = await _upload(db_session, org, admin)
        await _commit_all_batches(db_session, org, admin, first.id)
        attendance_before = (
            await db_session.execute(select(func.count(ShiftAttendance.id)))
        ).scalar()

        second = await _upload(db_session, org, admin)
        with pytest.raises(ValueError, match="already been imported"):
            await HistoricalImportService(db_session).create_shift_batches(
                org, second.id, admin
            )
        attendance_after = (
            await db_session.execute(select(func.count(ShiftAttendance.id)))
        ).scalar()
        assert attendance_after == attendance_before

    async def test_a_draft_carrying_a_committed_row_skips_it(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        service = HistoricalImportService(db_session)
        shifts = ShiftHistoryImportService(db_session)
        batches = await service.create_shift_batches(org, record.id, admin)
        batch = batches[0]
        rows = (
            (
                await db_session.execute(
                    select(ShiftHistoryImportRow).where(
                        ShiftHistoryImportRow.import_id == batch.id
                    )
                )
            )
            .scalars()
            .all()
        )
        # A second draft holding a copy of one row, as a racing second pass
        # would.
        twin = ShiftHistoryImport(
            id=_uid(),
            organization_id=org,
            status="draft",
            source_filename="twin",
            timezone="America/New_York",
            headers=batch.headers,
            column_mapping=batch.column_mapping,
            member_mappings={},
            unit_mappings={},
            position_mappings={},
            existing_shift_decisions={},
            source_system="FCVFD Hours DB",
            row_count=1,
            created_by=admin,
        )
        db_session.add(twin)
        await db_session.flush()
        crew_row = next(r for r in rows if r.raw["source_id"] == "9004")
        db_session.add(
            ShiftHistoryImportRow(
                id=_uid(),
                import_id=twin.id,
                line_number=crew_row.line_number,
                raw=dict(crew_row.raw),
                excluded=False,
            )
        )
        await db_session.commit()

        draft = await shifts.get_draft(org, batch.id)
        await shifts.update_mappings(
            draft,
            units={
                "|e116": {
                    "action": "create_external",
                    "agency_name": "County",
                    "unit_name": "E116",
                }
            },
        )
        await shifts.commit(org, batch.id, admin)

        analysis, _ = await shifts.analyze(await shifts.get_draft(org, twin.id))
        assert analysis.rows[0].skipped_reason == "Already imported (source row 9004)."
        with pytest.raises(ImportNotReady):
            await shifts.commit(org, twin.id, admin)

    async def test_two_commits_racing_on_one_row_collide_on_the_ledger(
        self, db_session
    ):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        service = HistoricalImportService(db_session)
        shifts = ShiftHistoryImportService(db_session)
        batch = (await service.create_shift_batches(org, record.id, admin))[0]
        draft = await shifts.get_draft(org, batch.id)
        await shifts.update_mappings(
            draft,
            units={
                "|e116": {
                    "action": "create_external",
                    "agency_name": "County",
                    "unit_name": "E116",
                }
            },
        )
        analysis, _ = await shifts.analyze(await shifts.get_draft(org, batch.id))
        assert analysis.can_commit

        # Another import enters a row after this one's analysis read the
        # ledger: the commit must fail rather than write the row a second time.
        original = shifts._imported_source_ids

        async def stale_read(*args, **kwargs):
            found = await original(*args, **kwargs)
            db_session.add(
                ImportedSourceRecord(
                    id=_uid(),
                    organization_id=org,
                    source_system="FCVFD Hours DB",
                    source_id="9001",
                    record_kind="shift_attendance",
                    record_id=_uid(),
                )
            )
            return found

        shifts._imported_source_ids = stale_read
        with pytest.raises(ImportNotReady, match="Another import"):
            await shifts.commit(org, batch.id, admin)


class TestPermission:
    def test_no_seeded_position_holds_it_but_the_owner(self):
        holders = [
            slug
            for slug, definition in DEFAULT_POSITIONS.items()
            if any(
                grant in ("*", "integrations.*", "integrations.historical_import")
                for grant in definition.get("permissions", [])
            )
        ]
        assert holders == ["it_manager"]

    def test_every_route_requires_it(self):
        from app.api.dependencies import PermissionChecker
        from app.api.v1.endpoints import historical_import as endpoint

        for route in endpoint.router.routes:
            required = [
                d.call.required_permissions
                for d in route.dependant.dependencies
                if isinstance(d.call, PermissionChecker)
            ]
            assert required == [["integrations.historical_import"]], route.path


class TestProbableMatchesInBulk:
    async def test_every_waiting_match_is_answered_at_once(self, db_session):
        org, admin = await _world(db_session)
        staggered = "\n".join(
            [
                HEADER,
                "101,2016-01-02,0700,1900,12,,,,,1,,,LA106",
                "102,2016-01-02,0730,1900,11.5,,,,,2,,,LA106",
                "101,2016-01-09,0700,1900,12,,,,,3,,,LA106",
                "102,2016-01-09,0730,1900,11.5,,,,,4,,,LA106",
            ]
        )
        record = await HistoricalImportService(db_session).create(
            org, admin, "staggered.csv", staggered, "FCVFD Hours DB", None
        )
        batch = (
            await HistoricalImportService(db_session).create_shift_batches(
                org, record.id, admin
            )
        )[0]
        shifts = ShiftHistoryImportService(db_session)
        analysis, _ = await shifts.analyze(await shifts.get_draft(org, batch.id))
        assert [i.code for i in analysis.issues].count("probable_match") == 2

        decided = await shifts.decide_probable_matches(
            await shifts.get_draft(org, batch.id), "accept"
        )
        assert decided == 2
        analysis, _ = await shifts.analyze(await shifts.get_draft(org, batch.id))
        assert analysis.can_commit
        assert [len(s.attendances) for s in analysis.shifts] == [2, 2]

    async def test_an_unknown_decision_is_refused(self, db_session):
        org, admin = await _world(db_session)
        record = await _upload(db_session, org, admin)
        batch = (
            await HistoricalImportService(db_session).create_shift_batches(
                org, record.id, admin
            )
        )[0]
        shifts = ShiftHistoryImportService(db_session)
        with pytest.raises(ValueError, match="Decision must be"):
            await shifts.decide_probable_matches(
                await shifts.get_draft(org, batch.id), "maybe"
            )
