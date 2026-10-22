"""
A permanent member delete removes that member — not other members' records —
and the preview says truthfully what goes.

Three defects, each pinned against a real database because every one of them
lives in an ``ON DELETE`` rule or a stock count no mock can see:

* ``skill_tests.examiner_id`` and ``shift_completion_reports.officer_id`` were
  ``CASCADE``: deleting an examiner or a field training officer deleted the
  trainees' evaluations and reports along with them. They are SET NULL now.
* The deletion preview named training records, inventory and documents while
  the delete also took RSVPs, attendance, shift assignments, dues, service
  history, consent records and more. It now counts every CASCADE reference,
  read from the models.
* Deleting a member who still held gear left individual items ``assigned`` to
  nobody, checked-out items ``checked_out`` forever, and pool counts short.
  The gear is now returned through the inventory service first.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import func, select, text

from app.api.v1.endpoints import users as users_endpoint
from app.core.database import Base
from app.models.inventory import (
    InventoryItem,
    ItemCondition,
    ItemStatus,
    TrackingType,
)
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.training import (
    Shift,
    ShiftAssignment,
    ShiftCompletionReport,
    StandingShiftClaim,
)
from app.schemas.shift_completion import ShiftCompletionReportResponse
from app.services.inventory_service import InventoryService
from app.services.user_deletion_service import _cascading_references

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Hard Delete FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"hd-{org_id[:8]}"},
    )
    return org_id


async def _add_member(db, org_id: str, last_name: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"hd_{user_id[:8]}",
            "ln": last_name,
            "em": f"hd_{user_id[:8]}@test.com",
        },
    )
    await db.flush()
    return user_id


@pytest.fixture
async def department(db_session):
    org_id = await _add_org(db_session)
    return SimpleNamespace(
        org=org_id,
        admin=await _add_member(db_session, org_id, "Admin"),
        examiner=await _add_member(db_session, org_id, "Examiner"),
        trainee=await _add_member(db_session, org_id, "Trainee"),
    )


@pytest.fixture(autouse=True)
def _quiet_guards(monkeypatch):
    """The privilege ceiling and administrator continuity have their own
    tests; the audit log is not what these assert on."""
    monkeypatch.setattr(users_endpoint, "log_audit_event", AsyncMock())
    monkeypatch.setattr(users_endpoint, "_enforce_account_reset_ceiling", AsyncMock())
    monkeypatch.setattr(users_endpoint, "assert_not_last_administrator", AsyncMock())


def _admin(dept) -> SimpleNamespace:
    return SimpleNamespace(id=dept.admin, organization_id=dept.org, username="admin")


async def _hard_delete(db, dept, user_id: str) -> None:
    await users_endpoint.delete_user(
        user_id=UUID(user_id), hard=True, db=db, current_user=_admin(dept)
    )


async def _fresh(db, model, row_id: str):
    """The row as the database now holds it, not the identity map's copy."""
    return (
        await db.execute(
            select(model)
            .where(model.id == row_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _skill_test(db, dept, *, candidate: str, examiner: str) -> SkillTest:
    template = SkillTemplate(
        organization_id=dept.org,
        name=f"SCBA {uuid.uuid4().hex[:6]}",
        sections=[{"title": "Donning", "criteria": []}],
        status="published",
    )
    db.add(template)
    await db.flush()
    test = SkillTest(
        organization_id=dept.org,
        template_id=template.id,
        candidate_id=candidate,
        examiner_id=examiner,
        status="completed",
        result="pass",
    )
    db.add(test)
    await db.flush()
    return test


async def _report(db, dept, *, trainee: str, officer: str) -> ShiftCompletionReport:
    report = ShiftCompletionReport(
        organization_id=dept.org,
        trainee_id=trainee,
        officer_id=officer,
        shift_date=date.today(),
        hours_on_shift=12.0,
        review_status="approved",
    )
    db.add(report)
    await db.flush()
    return report


class TestAnotherMembersRecordsSurvive:
    async def test_trainees_skill_test_survives_examiners_delete(
        self, db_session, department
    ):
        test = await _skill_test(
            db_session,
            department,
            candidate=department.trainee,
            examiner=department.examiner,
        )

        await _hard_delete(db_session, department, department.examiner)

        kept = await _fresh(db_session, SkillTest, test.id)
        assert kept is not None, "the examiner's delete took the trainee's test"
        assert kept.examiner_id is None
        assert kept.candidate_id == department.trainee
        assert kept.result == "pass"

    async def test_trainees_shift_report_survives_officers_delete(
        self, db_session, department
    ):
        report = await _report(
            db_session,
            department,
            trainee=department.trainee,
            officer=department.examiner,
        )

        await _hard_delete(db_session, department, department.examiner)

        kept = await _fresh(db_session, ShiftCompletionReport, report.id)
        assert kept is not None, "the officer's delete took the trainee's report"
        assert kept.officer_id is None
        assert kept.officer_name is None
        # The response a reader gets back must accept the missing officer.
        response = ShiftCompletionReportResponse.model_validate(kept)
        assert response.officer_id is None
        assert response.trainee_id == department.trainee

    async def test_the_deleted_members_own_records_still_go(
        self, db_session, department
    ):
        """SET NULL is for attribution only: the candidate's own test and the
        trainee's own report still CASCADE with them."""
        test = await _skill_test(
            db_session,
            department,
            candidate=department.trainee,
            examiner=department.examiner,
        )
        report = await _report(
            db_session,
            department,
            trainee=department.trainee,
            officer=department.examiner,
        )

        await _hard_delete(db_session, department, department.trainee)

        assert await _fresh(db_session, SkillTest, test.id) is None
        gone = await db_session.scalar(
            select(func.count())
            .select_from(ShiftCompletionReport)
            .where(ShiftCompletionReport.id == report.id)
        )
        assert gone == 0


class TestDeletionImpact:
    async def _seed_member_records(self, db, dept, member: str) -> None:
        now = datetime.now(timezone.utc)
        for days in (2, 9):
            shift = Shift(
                organization_id=dept.org,
                shift_date=(now + timedelta(days=days)).date(),
                start_time=now + timedelta(days=days),
            )
            db.add(shift)
            await db.flush()
            db.add(
                ShiftAssignment(
                    organization_id=dept.org,
                    shift_id=shift.id,
                    user_id=member,
                    position="firefighter",
                )
            )
        db.add(
            StandingShiftClaim(
                organization_id=dept.org,
                user_id=member,
                weekday=2,
                start_date=date.today(),
                end_date=date.today() + timedelta(days=60),
            )
        )
        await db.flush()
        # The member as candidate (theirs) and as examiner (someone else's).
        colleague = await _add_member(db, dept.org, "Colleague")
        await _skill_test(db, dept, candidate=member, examiner=colleague)
        await _skill_test(db, dept, candidate=colleague, examiner=member)

    async def _impact(self, db, dept, member: str):
        return await users_endpoint.get_deletion_impact(
            user_id=UUID(member), db=db, current_user=_admin(dept)
        )

    async def test_counts_every_table_the_delete_removes(self, db_session, department):
        member = department.trainee
        await self._seed_member_records(db_session, department, member)

        impact = await self._impact(db_session, department, member)

        by_table = {r.table: r for r in impact.removed_records}
        assert by_table["shift_assignments"].count == 2
        assert by_table["shift_assignments"].label == "Shift assignments"
        assert by_table["standing_shift_claims"].count == 1
        # Only the test the member sat; the one they examined is kept.
        assert by_table["skill_tests"].count == 1
        assert impact.total_records == sum(r.count for r in impact.removed_records)
        counts = [r.count for r in impact.removed_records]
        assert counts == sorted(counts, reverse=True)
        assert all(r.count > 0 for r in impact.removed_records)

    async def test_preview_matches_what_the_delete_actually_removes(
        self, db_session, department
    ):
        member = department.trainee
        await self._seed_member_records(db_session, department, member)
        impact = await self._impact(db_session, department, member)
        predicted = {r.table: r.count for r in impact.removed_records}

        before = await self._direct_counts(db_session, member)
        await _hard_delete(db_session, department, member)
        after = await self._direct_counts(db_session, member)

        removed = {t: before[t] - after[t] for t in before if before[t] - after[t]}
        assert removed == predicted

    async def _direct_counts(self, db, member: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for table_name, column_name in _cascading_references():
            table = Base.metadata.tables[table_name]
            counts[table_name] = counts.get(table_name, 0) + int(
                await db.scalar(
                    select(func.count())
                    .select_from(table)
                    .where(table.c[column_name] == member)
                )
                or 0
            )
        return counts

    async def test_rows_in_another_organization_are_not_counted(
        self, db_session, department
    ):
        member = department.trainee
        await self._seed_member_records(db_session, department, member)
        other_org = await _add_org(db_session)
        stray = Shift(
            organization_id=other_org,
            shift_date=date.today(),
            start_time=datetime.now(timezone.utc),
        )
        db_session.add(stray)
        await db_session.flush()
        db_session.add(
            ShiftAssignment(
                organization_id=other_org, shift_id=stray.id, user_id=member
            )
        )
        await db_session.flush()

        impact = await self._impact(db_session, department, member)

        by_table = {r.table: r.count for r in impact.removed_records}
        assert by_table["shift_assignments"] == 2

    async def test_attribution_references_are_not_listed_as_removed(self):
        """Tables where the member is only the attribution must stay out of the
        CASCADE set the preview counts from."""
        cascading = set(_cascading_references())
        assert ("skill_tests", "examiner_id") not in cascading
        assert ("shift_completion_reports", "officer_id") not in cascading
        assert ("skill_tests", "candidate_id") in cascading
        assert ("shift_completion_reports", "trainee_id") in cascading


class TestInventoryReturnedToStock:
    async def _item(self, db, dept, **fields) -> InventoryItem:
        item = InventoryItem(
            organization_id=dept.org,
            name=f"Item {uuid.uuid4().hex[:6]}",
            status=ItemStatus.AVAILABLE,
            condition=ItemCondition.GOOD,
            **fields,
        )
        db.add(item)
        await db.flush()
        return item

    async def test_held_gear_goes_back_to_stock(self, db_session, department):
        svc = InventoryService(db_session)
        member = department.trainee
        coat = await self._item(
            db_session, department, tracking_type=TrackingType.INDIVIDUAL
        )
        radio = await self._item(
            db_session, department, tracking_type=TrackingType.INDIVIDUAL
        )
        gloves = await self._item(
            db_session,
            department,
            tracking_type=TrackingType.POOL,
            quantity=10,
            quantity_issued=0,
        )

        _, err = await svc.assign_item_to_user(
            UUID(coat.id), UUID(member), department.org, department.admin
        )
        assert err is None, err
        _, err = await svc.checkout_item(
            radio.id, member, department.org, department.admin
        )
        assert err is None, err
        _, err = await svc.issue_from_pool(
            UUID(gloves.id), UUID(member), department.org, department.admin, 3
        )
        assert err is None, err

        impact = await users_endpoint.get_deletion_impact(
            user_id=UUID(member), db=db_session, current_user=_admin(department)
        )
        assert impact.inventory_items == 2
        assert impact.checked_out_items == 1

        await _hard_delete(db_session, department, member)

        coat = await _fresh(db_session, InventoryItem, coat.id)
        radio = await _fresh(db_session, InventoryItem, radio.id)
        gloves = await _fresh(db_session, InventoryItem, gloves.id)
        assert coat.assigned_to_user_id is None
        assert coat.status == ItemStatus.AVAILABLE
        assert radio.status == ItemStatus.AVAILABLE
        assert gloves.quantity_issued == 0
        assert gloves.quantity == 10
