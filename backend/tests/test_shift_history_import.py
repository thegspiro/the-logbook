"""Shift history import against the database: drafts, review, commit.

The matching rules themselves are covered without a database in
``test_shift_history_import_engine.py``. These pin what the service adds:

* **A draft writes nothing to the schedule**, and is reached only from its own
  organization.
* **A commit writes what every hours reader counts** — a finalized shift,
  a confirmed assignment and an attendance row per member, or outside-agency
  hours — and nothing it should not: no notifications, no completion drafts.
* **Former members become inactive records**, never accounts that can sign in.
* **A commit is final**, and importing the same history again adds nothing.
"""

import io
import json
import uuid
from datetime import date, datetime, timezone
from typing import List

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import shift_history_import as endpoint
from app.models.external_shift_hours import (
    ExternalAgency,
    ExternalApparatus,
    ExternalShiftHours,
)
from app.models.shift_history_import import ShiftHistoryImportRow
from app.models.training import (
    AssignmentStatus,
    BasicApparatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
)
from app.models.user import User, UserStatus
from app.schemas.shift_history_import import (
    MemberMapping,
    ShiftHistoryImportDetail,
    ShiftHistoryImportMappingsUpdate,
    ShiftHistoryImportRowUpdate,
)
from app.services import shift_history_import_engine
from app.services.scheduling_service import SchedulingService
from app.services.shift_history_import_service import (
    ImportNotDraft,
    ImportNotFound,
    ImportNotReady,
    ShiftHistoryImportService,
    read_csv,
)

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db: AsyncSession, name: str = "Volunteer FD") -> str:
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
            "slug": f"shi-{org_id[:8]}",
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


class World:
    def __init__(self, org_id: str, admin: str, alice: str, bob: str, a106e: str):
        self.org_id = org_id
        self.admin = admin
        self.alice = alice
        self.bob = bob
        self.a106e = a106e
        self.county_a106 = ""


@pytest.fixture
async def world(db_session: AsyncSession) -> World:
    org_id = await _add_org(db_session)
    admin = await _add_user(db_session, org_id, "Avery", "Chief", "1")
    alice = await _add_user(db_session, org_id, "Alice", "Ng", "101")
    bob = await _add_user(db_session, org_id, "Bob", "Diaz", "102")
    unit = BasicApparatus(
        id=_uid(), organization_id=org_id, unit_number="A106E", name="Ambulance"
    )
    agency = ExternalAgency(id=_uid(), organization_id=org_id, name="County EMS")
    db_session.add_all([unit, agency])
    await db_session.flush()
    county = ExternalApparatus(
        id=_uid(), organization_id=org_id, agency_id=agency.id, name="A106"
    )
    db_session.add(county)
    await db_session.flush()
    w = World(org_id, admin, alice, bob, unit.id)
    w.county_a106 = county.id
    return w


HEADER = "Member,Badge,Unit,Date,Time In,Time Out,Calls,Position,Status\n"


def _csv(*lines: str) -> str:
    return HEADER + "\n".join(lines) + "\n"


async def _draft(db: AsyncSession, w: World, text_: str):
    service = ShiftHistoryImportService(db)
    draft = await service.create_draft(w.org_id, w.admin, "history.csv", text_, None)
    return service, draft


class TestReadingTheFile:
    def test_repeated_header_is_refused(self):
        with pytest.raises(ValueError, match="repeats"):
            read_csv("unit,Unit\nE1,E1\n")

    def test_blank_lines_are_ignored(self):
        headers, rows = read_csv("a,b\n1,2\n,\n3,4\n")
        assert headers == ["a", "b"]
        assert len(rows) == 2

    def test_header_only_is_refused(self):
        with pytest.raises(ValueError, match="no data rows"):
            read_csv("a,b\n")


class TestDrafts:
    async def test_upload_detects_columns_and_writes_nothing(self, db_session, world):
        service, draft = await _draft(
            db_session,
            world,
            _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,4,,"),
        )
        assert draft.timezone == "America/New_York"
        assert draft.column_mapping["start_time"] == "Time In"
        assert draft.row_count == 1
        shifts = await db_session.scalar(
            select(func.count(Shift.id)).where(Shift.organization_id == world.org_id)
        )
        assert shifts == 0

        detail = await service.detail(draft)
        assert detail["analysis"]["can_commit"]
        assert detail["analysis"]["counts"]["new_shifts"] == 1

    async def test_another_organization_cannot_reach_the_draft(self, db_session, world):
        service, draft = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,,,")
        )
        other_org = await _add_org(db_session, "Elsewhere")
        with pytest.raises(ImportNotFound):
            await service.get_import(other_org, draft.id)
        with pytest.raises(ImportNotFound):
            await service.discard(other_org, draft.id)

    async def test_a_row_of_another_draft_cannot_be_edited_through_this_one(
        self, db_session, world
    ):
        service, first = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,,,")
        )
        _, second = await _draft(
            db_session, world, _csv("Bob Diaz,102,A106E,2025-03-01,0700,0700,,,")
        )
        foreign_row = (await service.rows(second))[0]
        with pytest.raises(ImportNotFound):
            await service.update_row(first, foreign_row.id, excluded=True)

    async def test_mapping_to_another_organizations_member_is_refused(
        self, db_session, world
    ):
        service, draft = await _draft(
            db_session, world, _csv("J. Ng,,A106E,2025-03-01,0700,0700,,,")
        )
        other_org = await _add_org(db_session, "Elsewhere")
        stranger = await _add_user(db_session, other_org, "Jo", "Ng", "9")
        with pytest.raises(ValueError, match="Invalid member"):
            await service.update_mappings(
                draft, members={"name:j. ng": {"action": "map", "user_id": stranger}}
            )

    async def test_edits_correct_a_row_and_can_be_reverted(self, db_session, world):
        service, draft = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,07OO,0700,,,")
        )
        row = (await service.rows(draft))[0]
        analysis, _ = await service.analyze(draft)
        assert analysis.blocking_issue_count == 1

        await service.update_row(draft, row.id, edits={"start_time": "0700"})
        analysis, _ = await service.analyze(draft)
        assert analysis.can_commit

        await service.update_row(draft, row.id, edits={"start_time": None})
        stored = await db_session.get(ShiftHistoryImportRow, row.id)
        assert stored is not None
        assert stored.edits is None

    async def test_unknown_seat_mapping_is_refused(self, db_session, world):
        service, draft = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,,Nozzle,")
        )
        with pytest.raises(ValueError, match="not a seat"):
            await service.update_mappings(
                draft, positions={"nozzle": {"seat": "Not A Seat"}}
            )
        await service.update_mappings(
            draft, positions={"nozzle": {"seat": "firefighter"}}
        )
        analysis, _ = await service.analyze(draft)
        assert analysis.can_commit


class TestCommit:
    async def _committed(self, db_session, world, rows: List[str], **mappings):
        service, draft = await _draft(db_session, world, _csv(*rows))
        if mappings:
            await service.update_mappings(draft, **mappings)
        return service, await service.commit(world.org_id, draft.id, world.admin)

    async def test_writes_a_finalized_shift_that_hours_reports_count(
        self, db_session, world
    ):
        _, draft = await self._committed(
            db_session,
            world,
            [
                "Alice Ng,101,A106E,2025-03-01,0700,0700,4,officer,",
                "Bob Diaz,102,A106E,2025-03-01,0715,0700,3,,",
            ],
        )
        shift = (
            await db_session.execute(
                select(Shift).where(Shift.organization_id == world.org_id)
            )
        ).scalar_one()
        assert shift.is_finalized
        assert shift.apparatus_id == world.a106e
        assert shift.shift_date == date(2025, 3, 1)
        # Crew call count is the crew's calls, not their sum.
        assert shift.call_count == 4
        assert shift.total_hours == round((24 * 60 + 23 * 60 + 45) / 60, 1)

        assignments = {
            a.user_id: a
            for a in (
                await db_session.execute(
                    select(ShiftAssignment).where(ShiftAssignment.shift_id == shift.id)
                )
            ).scalars()
        }
        assert assignments[world.alice].position == "officer"
        assert assignments[world.bob].position == "firefighter"
        assert all(
            a.assignment_status == AssignmentStatus.CONFIRMED
            for a in assignments.values()
        )

        report = await SchedulingService(db_session).get_member_hours_report(
            uuid.UUID(world.org_id), date(2025, 3, 1), date(2025, 3, 31)
        )
        by_user = {r["user_id"]: r for r in report}
        assert by_user[world.alice]["worked_minutes"] == 24 * 60
        assert draft.summary["shifts_created"] == 1
        assert draft.summary["attendance_created"] == 2

    async def test_split_entries_land_as_one_25_and_a_half_hour_attendance(
        self, db_session, world
    ):
        await self._committed(
            db_session,
            world,
            [
                "Alice Ng,101,A106E,2025-10-09,0600,0600,,,",
                "Alice Ng,101,A106E,2025-10-10,0600,0730,,,",
            ],
        )
        attendance = (
            await db_session.execute(
                select(ShiftAttendance)
                .join(Shift, Shift.id == ShiftAttendance.shift_id)
                .where(Shift.organization_id == world.org_id)
            )
        ).scalar_one()
        assert attendance.duration_minutes == 25 * 60 + 30

    async def test_outside_unit_becomes_external_hours(self, db_session, world):
        await self._committed(
            db_session,
            world,
            ["Alice Ng,101,A106,2025-03-01,0700,1900,,Driver,"],
        )
        entry = (
            await db_session.execute(
                select(ExternalShiftHours).where(
                    ExternalShiftHours.organization_id == world.org_id
                )
            )
        ).scalar_one()
        assert entry.external_apparatus_id == world.county_a106
        assert entry.agency_name == "County EMS"
        assert entry.duration_minutes == 12 * 60
        assert entry.role == "Driver"
        assert (
            await db_session.scalar(
                select(func.count(Shift.id)).where(
                    Shift.organization_id == world.org_id
                )
            )
            == 0
        )

    async def test_new_outside_unit_and_agency_are_created(self, db_session, world):
        _, draft = await self._committed(
            db_session,
            world,
            ["Alice Ng,101,M7,2025-03-01,0700,1900,,,"],
            units={
                "|m7": {
                    "action": "create_external",
                    "agency_name": "Metro Fire",
                    "unit_name": "M7",
                }
            },
        )
        assert draft.summary["agencies_created"] == 1
        assert draft.summary["external_units_created"] == 1
        assert draft.summary["external_hours_created"] == 1

    async def test_former_member_becomes_an_inactive_record(self, db_session, world):
        _, draft = await self._committed(
            db_session,
            world,
            ["Dana Former,77,A106E,2019-06-01,0700,0700,,,"],
            members={"number:77": {"action": "create"}},
        )
        created = (
            await db_session.execute(
                select(User).where(
                    User.organization_id == world.org_id,
                    User.membership_number == "77",
                )
            )
        ).scalar_one()
        assert created.status == UserStatus.INACTIVE
        # A record of someone who served, not a login.
        assert not created.is_active
        assert created.password_hash is None
        assert (created.first_name, created.last_name) == ("Dana", "Former")
        assert created.email.endswith("@import.invalid")
        assert draft.summary["members_created"] == 1

    async def test_a_former_member_keeps_identifiers_the_file_gave(
        self, db_session, world
    ):
        service, draft = await _draft(
            db_session,
            world,
            "Member,Email,Username,Unit,Date,Start,End\n"
            "Dana Former,dana@old.test,dformer,A106E,2019-06-01,0700,0700\n",
        )
        await service.update_mappings(
            draft, members={"email:dana@old.test": {"action": "create"}}
        )
        await service.commit(world.org_id, draft.id, world.admin)
        created = (
            await db_session.execute(select(User).where(User.email == "dana@old.test"))
        ).scalar_one()
        assert created.username == "dformer"

    async def test_cancelled_and_no_show_rows_are_not_written(self, db_session, world):
        _, draft = await self._committed(
            db_session,
            world,
            [
                "Alice Ng,101,A106E,2025-03-01,0700,0700,,,",
                "Bob Diaz,102,A106E,2025-03-01,0700,0700,,,No Show",
            ],
        )
        assert draft.summary["rows_skipped"] == 1
        assert draft.summary["attendance_created"] == 1

    async def test_commit_is_final(self, db_session, world):
        service, draft = await self._committed(
            db_session, world, ["Alice Ng,101,A106E,2025-03-01,0700,0700,,,"]
        )
        with pytest.raises(ImportNotDraft):
            await service.commit(world.org_id, draft.id, world.admin)
        with pytest.raises(ImportNotDraft):
            await service.discard(world.org_id, draft.id)
        detail = await service.detail(draft)
        assert detail["analysis"] is None

    async def test_commit_refused_while_issues_remain(self, db_session, world):
        service, draft = await _draft(
            db_session, world, _csv("Unknown Person,,A106E,2025-03-01,0700,0700,,,")
        )
        with pytest.raises(ImportNotReady):
            await service.commit(world.org_id, draft.id, world.admin)

    async def test_reimporting_the_same_history_adds_nothing(self, db_session, world):
        rows = [
            "Alice Ng,101,A106E,2025-03-01,0700,0700,,,",
            "Alice Ng,101,A106,2025-03-02,0700,1900,,,",
        ]
        await self._committed(db_session, world, rows)
        service, again = await _draft(db_session, world, _csv(*rows))
        analysis, _ = await service.analyze(again)
        assert analysis.blocking_issue_count == 0
        assert analysis.shifts[0].existing_status == "auto"
        assert all(a.duplicate_existing for a in analysis.shifts[0].attendances)
        assert all(a.duplicate_existing for a in analysis.external)
        with pytest.raises(ImportNotReady, match="Nothing"):
            await service.commit(world.org_id, again.id, world.admin)

    async def test_a_probable_existing_shift_takes_the_crew_once_accepted(
        self, db_session, world
    ):
        existing = Shift(
            id=_uid(),
            organization_id=world.org_id,
            shift_date=date(2025, 3, 1),
            start_time=datetime(2025, 3, 1, 12, 30, tzinfo=timezone.utc),
            end_time=datetime(2025, 3, 2, 12, 30, tzinfo=timezone.utc),
            apparatus_id=world.a106e,
            is_finalized=True,
        )
        db_session.add(existing)
        await db_session.flush()
        service, draft = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,2,,")
        )
        analysis, _ = await service.analyze(draft)
        assert analysis.shifts[0].existing_status == "pending"
        key = analysis.shifts[0].key
        await service.update_mappings(draft, existing_shifts={key: "accept"})
        committed = await service.commit(world.org_id, draft.id, world.admin)

        assert committed.summary["shifts_updated"] == 1
        assert committed.summary["shifts_created"] == 0
        attendance = (
            await db_session.execute(
                select(ShiftAttendance).where(ShiftAttendance.shift_id == existing.id)
            )
        ).scalar_one()
        assert attendance.user_id == world.alice
        await db_session.refresh(existing)
        assert existing.total_hours == 24.0
        assert existing.call_count == 2

    async def test_creates_no_completion_reports(self, db_session, world):
        await self._committed(
            db_session, world, ["Alice Ng,101,A106E,2025-03-01,0700,0700,,,"]
        )
        reports = await db_session.execute(
            text(
                "SELECT COUNT(*) FROM shift_completion_reports r "
                "JOIN shifts s ON s.id = r.shift_id WHERE s.organization_id = :org"
            ),
            {"org": world.org_id},
        )
        assert reports.scalar() == 0


class TestEndpoints:
    """The HTTP layer: upload checks, status codes, and org isolation."""

    @staticmethod
    def _upload(body: str, name: str = "history.csv"):
        from fastapi import UploadFile

        return UploadFile(file=io.BytesIO(body.encode()), filename=name)

    async def test_template_is_the_detected_header_row(self, db_session, world):
        admin = await db_session.get(User, world.admin)
        response = await endpoint.download_template(current_user=admin)
        body = "".join([str(chunk) async for chunk in response.body_iterator])
        assert body.strip() == ",".join(shift_history_import_engine.TEMPLATE_HEADERS)

    async def test_only_csv_is_accepted(self, db_session, world):
        admin = await db_session.get(User, world.admin)
        with pytest.raises(HTTPException) as caught:
            await endpoint.upload_import(
                file=self._upload("a,b\n", "history.xlsx"),
                timezone=None,
                db=db_session,
                current_user=admin,
            )
        assert caught.value.status_code == 400

    async def test_unknown_timezone_is_a_400(self, db_session, world):
        admin = await db_session.get(User, world.admin)
        with pytest.raises(HTTPException) as caught:
            await endpoint.upload_import(
                file=self._upload(_csv("Alice Ng,101,A106E,2025-03-01,0700,0700,,,")),
                timezone="Mars/Olympus",
                db=db_session,
                current_user=admin,
            )
        assert caught.value.status_code == 400

    async def test_upload_review_and_commit(self, db_session, world):
        admin = await db_session.get(User, world.admin)
        summary = await endpoint.upload_import(
            file=self._upload(_csv("Dana Former,77,A106E,2019-06-01,0700,0700,,,")),
            timezone="America/Chicago",
            db=db_session,
            current_user=admin,
        )
        import_id = uuid.UUID(summary["id"])
        assert summary["timezone"] == "America/Chicago"

        with pytest.raises(HTTPException) as not_ready:
            await endpoint.commit_import(
                import_id=import_id, db=db_session, current_user=admin
            )
        assert not_ready.value.status_code == 409

        detail = await endpoint.update_import_mappings(
            import_id=import_id,
            payload=ShiftHistoryImportMappingsUpdate(
                members={"number:77": MemberMapping(action="create")}
            ),
            db=db_session,
            current_user=admin,
        )
        assert detail["analysis"]["can_commit"]
        ShiftHistoryImportDetail.model_validate(detail)

        committed = await endpoint.commit_import(
            import_id=import_id, db=db_session, current_user=admin
        )
        assert committed["status"] == "committed"
        assert committed["summary"]["members_created"] == 1

        with pytest.raises(HTTPException) as final:
            await endpoint.discard_import(
                import_id=import_id, db=db_session, current_user=admin
            )
        assert final.value.status_code == 409

    async def test_row_decision_can_be_cleared(self, db_session, world):
        admin = await db_session.get(User, world.admin)
        service, draft = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,,,")
        )
        row = (await service.rows(draft))[0]
        await endpoint.update_import_row(
            import_id=uuid.UUID(draft.id),
            row_id=uuid.UUID(row.id),
            payload=ShiftHistoryImportRowUpdate(match_decision="separate"),
            db=db_session,
            current_user=admin,
        )
        await db_session.refresh(row)
        assert row.match_decision == "separate"
        await endpoint.update_import_row(
            import_id=uuid.UUID(draft.id),
            row_id=uuid.UUID(row.id),
            payload=ShiftHistoryImportRowUpdate(match_decision=None),
            db=db_session,
            current_user=admin,
        )
        await db_session.refresh(row)
        assert row.match_decision is None

    async def test_another_organizations_admin_gets_a_404(self, db_session, world):
        _, draft = await _draft(
            db_session, world, _csv("Alice Ng,101,A106E,2025-03-01,0700,0700,,,")
        )
        other_org = await _add_org(db_session, "Elsewhere")
        outsider = await db_session.get(
            User, await _add_user(db_session, other_org, "Olly", "Out", "5")
        )
        for call in (
            endpoint.get_import(
                import_id=uuid.UUID(draft.id), db=db_session, current_user=outsider
            ),
            endpoint.commit_import(
                import_id=uuid.UUID(draft.id), db=db_session, current_user=outsider
            ),
        ):
            with pytest.raises(HTTPException) as caught:
                await call
            assert caught.value.status_code == 404


class TestRemovedMembers:
    async def test_a_new_member_cannot_take_a_removed_members_number(
        self, db_session, world
    ):
        removed = await _add_user(db_session, world.org_id, "Rae", "Gone", "88")
        await db_session.execute(
            text("UPDATE users SET deleted_at = NOW() WHERE id = :id"),
            {"id": removed},
        )
        service, draft = await _draft(
            db_session, world, _csv("Dana Former,88,A106E,2019-06-01,0700,0700,,,")
        )
        analysis, _ = await service.analyze(draft)
        # A removed member is not offered as a match...
        assert analysis.members[0].status == "unmatched"
        await service.update_mappings(
            draft, members={"number:88": {"action": "create"}}
        )
        analysis, _ = await service.analyze(draft)
        # ...but still holds the number, so creating over it is refused here
        # rather than by the unique index at commit.
        assert [i.code for i in analysis.issues] == ["new_member_identifier_taken"]
