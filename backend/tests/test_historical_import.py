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
    HistoricalImportNotReady,
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
        # Training rows are imported by their own commit, not yet run.
        assert by_id["9006"][5] == "not_sent"
        # Administrative rows are imported by their own commit, not yet run.
        assert by_id["9007"][5] == "not_sent"
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


ADMIN_HEADER = (
    "VID,Date,Start,End,Admin,PubEd,UniqueID,AdminActivity,OperationSanta,BDParty"
)
ADMIN_CSV = "\n".join(
    [
        ADMIN_HEADER,
        "101,2015-11-09 00:00:00.000,2000,2045,0.75,,7001,Bus meeting,0,0",
        "101,2015-12-10 00:00:00.000,1800,2100,3.0,,7002,Santamobile,1,0",
        "102,2015-12-11 00:00:00.000,1400,1700,,3.0,7003,,0,1",
        # Known to the file only by number: a former member.
        "6178,2015-12-12 00:00:00.000,1900,2100,2.0,,7004,Treasurer's work,0,0",
    ]
)


async def _admin_world(db_session):
    from app.models.admin_hours import AdminHoursCategory

    org, admin = await _world(db_session)
    categories = {}
    for name in ("Administrative Work", "SantaMobile", "Community Outreach"):
        category = AdminHoursCategory(id=_uid(), organization_id=org, name=name)
        db_session.add(category)
        categories[name] = category.id
    await db_session.commit()
    service = HistoricalImportService(db_session)
    record = await service.create(
        org, admin, "admin.csv", ADMIN_CSV, "FCVFD Hours DB", None
    )
    await service.update_admin_settings(
        record,
        {
            "description_columns": ["AdminActivity"],
            "flag_categories": [
                {"column": "OperationSanta", "category_id": categories["SantaMobile"]},
                {"column": "BDParty", "category_id": categories["Community Outreach"]},
            ],
            "default_categories": {
                "Admin": categories["Administrative Work"],
                "PubEd": categories["Community Outreach"],
            },
        },
    )
    return org, admin, categories, record


class TestAdminHours:
    async def test_the_preview_names_what_still_needs_deciding(self, db_session):
        org, _, _, record = await _admin_world(db_session)
        service = HistoricalImportService(db_session)
        preview = await service.admin_preview(await service.get(org, record.id))

        assert preview["pending_records"] == 4
        assert [m["key"] for m in preview["members"]] == ["number:6178"]
        assert preview["can_commit"] is False
        with pytest.raises(HistoricalImportNotReady, match="need a decision"):
            await service.commit_admin(org, record.id, _uid())

    async def test_a_commit_writes_approved_imported_entries(self, db_session):
        from app.models.admin_hours import (
            AdminHoursEntry,
            AdminHoursEntryMethod,
            AdminHoursEntryStatus,
        )
        from app.models.user import User, UserStatus

        org, admin, categories, record = await _admin_world(db_session)
        service = HistoricalImportService(db_session)
        await service.update_member_mappings(
            await service.get(org, record.id), {"number:6178": {"action": "create"}}
        )
        counts = await service.commit_admin(org, record.id, admin)
        assert counts == {"entries_created": 4, "members_created": 1}

        entries = (
            (
                await db_session.execute(
                    select(AdminHoursEntry).where(
                        AdminHoursEntry.organization_id == org
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {e.entry_method for e in entries} == {AdminHoursEntryMethod.IMPORT}
        assert {e.status for e in entries} == {AdminHoursEntryStatus.APPROVED}
        by_minutes = {e.duration_minutes: e for e in entries}
        assert by_minutes[45].category_id == categories["Administrative Work"]
        assert by_minutes[45].description == "Bus meeting"
        assert sorted(
            e.category_id for e in entries if e.duration_minutes == 180
        ) == sorted([categories["SantaMobile"], categories["Community Outreach"]])

        former = (
            await db_session.execute(
                select(User).where(
                    User.organization_id == org, User.membership_number == "6178"
                )
            )
        ).scalar_one()
        assert former.status == UserStatus.ARCHIVED
        assert (former.first_name, former.last_name) == ("Former member", "6178")
        assert former.password_hash is None

    async def test_committing_twice_writes_nothing_twice(self, db_session):
        from app.models.admin_hours import AdminHoursEntry

        org, admin, _, record = await _admin_world(db_session)
        service = HistoricalImportService(db_session)
        await service.update_member_mappings(
            await service.get(org, record.id), {"number:6178": {"action": "create"}}
        )
        await service.commit_admin(org, record.id, admin)
        with pytest.raises(HistoricalImportNotReady, match="already been imported"):
            await service.commit_admin(org, record.id, admin)

        # The same export uploaded again finds every row in the ledger, and
        # the member created the first time is remembered rather than created
        # a second time.
        again = await service.create(
            org, admin, "admin.csv", ADMIN_CSV, "FCVFD Hours DB", None
        )
        preview = await service.admin_preview(await service.get(org, again.id))
        assert preview["pending_records"] == 0
        assert preview["already_imported"] == 4
        assert preview["members"] == []
        total = (
            await db_session.execute(
                select(func.count(AdminHoursEntry.id)).where(
                    AdminHoursEntry.organization_id == org
                )
            )
        ).scalar()
        assert total == 4

    async def test_a_category_from_another_department_is_refused(self, db_session):
        from app.models.admin_hours import AdminHoursCategory

        org, _, _, record = await _admin_world(db_session)
        other = await _add_org(db_session, "Other FD")
        foreign = AdminHoursCategory(id=_uid(), organization_id=other, name="Theirs")
        db_session.add(foreign)
        await db_session.commit()
        service = HistoricalImportService(db_session)
        with pytest.raises(ValueError, match="Admin Hours categories"):
            await service.update_admin_settings(
                await service.get(org, record.id),
                {"default_categories": {"Admin": foreign.id}},
            )

    async def test_a_row_without_a_category_blocks_the_commit(self, db_session):
        org, admin, _, record = await _admin_world(db_session)
        service = HistoricalImportService(db_session)
        await service.update_admin_settings(await service.get(org, record.id), {})
        await service.update_member_mappings(
            await service.get(org, record.id), {"number:6178": {"action": "create"}}
        )
        preview = await service.admin_preview(await service.get(org, record.id))
        assert preview["uncategorized"] == 4
        with pytest.raises(HistoricalImportNotReady, match="no category"):
            await service.commit_admin(org, record.id, admin)


TRAINING_HEADER = (
    "VID,Date,Start,End,Training,UniqueID,TrainingSubject,TrainingInstructor,Instructor"
)
TRAINING_CSV = "\n".join(
    [
        TRAINING_HEADER,
        "101,2016-02-01,1900,2100,2.0,8001,EMT-B,NVCC,0",
        "102,2016-02-01,1900,2100,2.0,8002,emt b,NVCC,0",
        # Bob taught this one and wrote "me" for the instructor.
        "102,2016-02-08,1900,2200,3.0,8003,Ladders,me,1",
        # Target Solutions, already synced for Alice.
        "101,2016-03-10,1200,1300,1.0,8004,HIPAA,Target Solutions,0",
        # Target Solutions, nothing synced.
        "101,2016-04-10,1200,1300,1.0,8005,Bloodborne,Vector Solutions,0",
    ]
)


async def _training_world(db_session):
    from app.models.training import (
        ExternalProviderType,
        ExternalTrainingProvider,
        TrainingCategory,
        TrainingCourse,
        TrainingRecord,
        TrainingStatus,
        TrainingType,
    )
    from app.models.user import User

    org, admin = await _world(db_session)
    category = TrainingCategory(id=_uid(), organization_id=org, name="EMS", active=True)
    db_session.add(category)
    course = TrainingCourse(
        id=_uid(),
        organization_id=org,
        name="EMT-B",
        code="EMTB",
        training_type=TrainingType.CERTIFICATION,
        category_ids=[category.id],
        active=True,
    )
    db_session.add(course)
    provider = ExternalTrainingProvider(
        id=_uid(),
        organization_id=org,
        name="Target Solutions",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
    )
    db_session.add(provider)
    await db_session.flush()
    alice = (
        await db_session.execute(
            select(User.id).where(
                User.organization_id == org, User.membership_number == "101"
            )
        )
    ).scalar_one()
    from datetime import date

    db_session.add(
        TrainingRecord(
            id=_uid(),
            organization_id=org,
            user_id=alice,
            course_name="HIPAA Awareness",
            training_type=TrainingType.CONTINUING_EDUCATION,
            completion_date=date(2016, 3, 11),
            hours_completed=1,
            status=TrainingStatus.COMPLETED,
            external_provider_id=provider.id,
            external_record_id="ts-1",
        )
    )
    await db_session.commit()
    record = await HistoricalImportService(db_session).create(
        org, admin, "training.csv", TRAINING_CSV, "FCVFD Hours DB", None
    )
    return org, admin, course, category, record


class TestTraining:
    async def test_the_preview_finds_synced_rows_and_asks_about_the_rest(
        self, db_session
    ):
        org, _, course, _, record = await _training_world(db_session)
        service = HistoricalImportService(db_session)
        preview = await service.training_preview(await service.get(org, record.id))

        assert preview["provider_rows"] == 2
        assert preview["provider_matched"] == 1
        assert preview["provider_unmatched"] == 1
        # Four would be written: the synced HIPAA row never is.
        assert preview["pending_records"] == 4
        assert preview["can_commit"] is False
        emt = next(s for s in preview["subjects"] if s["key"] == "emt b")
        assert emt["records"] == 2
        assert emt["suggested_course_id"] == course.id
        with pytest.raises(HistoricalImportNotReady, match="import or skip"):
            await service.commit_training(org, record.id, _uid())

    async def test_a_commit_writes_records_the_way_a_mapped_sync_would(
        self, db_session
    ):
        from app.models.training import TrainingRecord, TrainingType

        org, admin, course, category, record = await _training_world(db_session)
        service = HistoricalImportService(db_session)
        assert (
            await service.accept_suggested_courses(await service.get(org, record.id))
            == 1
        )
        await service.update_training_settings(
            await service.get(org, record.id), {"unmatched_provider_action": "import"}
        )
        counts = await service.commit_training(org, record.id, admin)
        assert counts["records_created"] == 4
        assert counts["provider_duplicates_skipped"] == 1

        records = (
            (
                await db_session.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org,
                        TrainingRecord.external_provider_id.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        mapped = [r for r in records if r.course_id == course.id]
        assert len(mapped) == 2
        assert {r.category_id for r in mapped} == {category.id}
        assert {r.training_type for r in mapped} == {TrainingType.CERTIFICATION}
        assert {r.course_name for r in mapped} == {"EMT-B"}
        taught = next(r for r in records if r.course_name == "Ladders")
        assert taught.instructor == "Bob Diaz"
        assert taught.notes.endswith("taught this class.")
        assert taught.training_type == TrainingType.CONTINUING_EDUCATION
        assert taught.hours_completed == 3.0
        assert {r.instructor for r in mapped} == {"NVCC"}

    async def test_skipping_unmatched_provider_rows_leaves_them_out(self, db_session):
        org, admin, _, _, record = await _training_world(db_session)
        service = HistoricalImportService(db_session)
        await service.update_training_settings(
            await service.get(org, record.id), {"unmatched_provider_action": "skip"}
        )
        counts = await service.commit_training(org, record.id, admin)
        assert counts["records_created"] == 3
        assert counts["provider_unmatched_skipped"] == 1

    async def test_committing_twice_writes_nothing_twice(self, db_session):
        from app.models.training import TrainingRecord

        org, admin, _, _, record = await _training_world(db_session)
        service = HistoricalImportService(db_session)
        await service.update_training_settings(
            await service.get(org, record.id), {"unmatched_provider_action": "import"}
        )
        await service.commit_training(org, record.id, admin)
        with pytest.raises(HistoricalImportNotReady, match="already"):
            await service.commit_training(org, record.id, admin)
        again = await service.create(
            org, admin, "training.csv", TRAINING_CSV, "FCVFD Hours DB", None
        )
        preview = await service.training_preview(await service.get(org, again.id))
        assert preview["pending_records"] == 0
        total = (
            await db_session.execute(
                select(func.count(TrainingRecord.id)).where(
                    TrainingRecord.organization_id == org
                )
            )
        ).scalar()
        # Four imported plus the one synced record that was already there.
        assert total == 5

    async def test_a_course_from_another_department_is_refused(self, db_session):
        from app.models.training import TrainingCourse, TrainingType

        org, _, _, _, record = await _training_world(db_session)
        other = await _add_org(db_session, "Other FD")
        foreign = TrainingCourse(
            id=_uid(),
            organization_id=other,
            name="Theirs",
            training_type=TrainingType.CERTIFICATION,
            active=True,
        )
        db_session.add(foreign)
        await db_session.commit()
        service = HistoricalImportService(db_session)
        with pytest.raises(ValueError, match="active courses"):
            await service.update_training_settings(
                await service.get(org, record.id),
                {"subject_courses": {"emt b": foreign.id}},
            )
