"""Reports (app-review B16 pass 6).

- The annual training report leaves deleted members out, counts hours from
  completed records only, and counts approved shift reports only.
- The training summary counts completed hours only.
- The inventory report reads ``quantity`` as the on-hand count, does not turn
  an empty shelf into one unit, and leaves retired items out.
- The roster's join date is the member's hire date where there is one.
- A filter of the wrong shape is ignored instead of raising.
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import text

from app.models.training import (
    ShiftCompletionReport,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.services.reports_service import ReportsService

pytestmark = pytest.mark.integration


async def _org(db):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Pass6 Reports', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"rpt6-{org_id[:8]}"},
    )
    return org_id


async def _member(db, org_id, first, deleted=False, hire=None):
    uid = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, deleted_at, hire_date, created_at) VALUES "
            "(:id, :org, :un, :f, 'M', :em, 'x', 'active', :del, :hire, :ca)"
        ),
        {
            "id": uid,
            "org": org_id,
            "un": f"u-{uid[:8]}",
            "f": first,
            "em": f"{uid[:8]}@example.com",
            "del": datetime(2026, 3, 1, tzinfo=timezone.utc) if deleted else None,
            "hire": hire,
            "ca": datetime(2026, 1, 15, tzinfo=timezone.utc),
        },
    )
    return uid


def _record(org, uid, status, hours):
    return TrainingRecord(
        organization_id=org,
        user_id=uid,
        course_name="Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        status=status,
        completion_date=date(2026, 5, 9),
        hours_completed=hours,
    )


def _shift(org, uid, day, hours, calls, review_status):
    return ShiftCompletionReport(
        organization_id=org,
        shift_date=date(2026, 5, day),
        trainee_id=uid,
        hours_on_shift=hours,
        calls_responded=calls,
        review_status=review_status,
    )


class TestAnnualTraining:
    async def test_counts_completed_training_and_approved_shifts_of_current_members(
        self, db_session
    ):
        org = await _org(db_session)
        current = await _member(db_session, org, "Current")
        await _member(db_session, org, "Departed", deleted=True)
        db_session.add_all(
            [
                _record(org, current, TrainingStatus.COMPLETED, 4.0),
                _record(org, current, TrainingStatus.FAILED, 8.0),
                _record(org, current, TrainingStatus.CANCELLED, 2.0),
                _shift(org, current, 9, 12.0, 3, "draft"),
                _shift(org, current, 10, 12.0, 2, "flagged"),
                _shift(org, current, 11, 10.0, 4, "approved"),
            ]
        )
        await db_session.flush()

        report = await ReportsService(db_session).generate_report(
            org, "annual_training", filters={"year": 2026}
        )

        assert [e["member_name"] for e in report["entries"]] == ["Current M"]
        assert report["summary"]["total_members"] == 1
        entry = report["entries"][0]
        assert entry["training_hours"] == 4.0
        assert entry["shift_hours"] == 10.0
        assert entry["shifts_completed"] == 1
        assert entry["calls_responded"] == 4


class TestTrainingSummary:
    async def test_counts_completed_hours_only(self, db_session):
        org = await _org(db_session)
        member = await _member(db_session, org, "Pat")
        db_session.add_all(
            [
                _record(org, member, TrainingStatus.COMPLETED, 4.0),
                _record(org, member, TrainingStatus.FAILED, 8.0),
            ]
        )
        await db_session.flush()

        report = await ReportsService(db_session).generate_report(
            org, "training_summary", date(2026, 1, 1), date(2026, 12, 31)
        )

        (entry,) = report["entries"]
        assert entry["total_hours"] == 4.0


class TestInventoryStatus:
    async def test_quantities_are_on_hand_and_retired_items_are_left_out(
        self, db_session
    ):
        from app.models.inventory import (
            InventoryCategory,
            InventoryItem,
            ItemType,
            TrackingType,
        )

        org = await _org(db_session)
        category = InventoryCategory(
            organization_id=org,
            name="Gloves",
            item_type=list(ItemType)[0],
            low_stock_threshold=5,
        )
        db_session.add(category)
        await db_session.flush()
        db_session.add_all(
            [
                # 10 received, 4 issued: issuing lowered quantity to 6.
                InventoryItem(
                    organization_id=org,
                    category_id=category.id,
                    name="Gloves M",
                    tracking_type=TrackingType.POOL,
                    quantity=6,
                    quantity_issued=4,
                ),
                InventoryItem(
                    organization_id=org,
                    category_id=category.id,
                    name="Gloves L",
                    tracking_type=TrackingType.POOL,
                    quantity=0,
                    quantity_issued=10,
                ),
                InventoryItem(
                    organization_id=org,
                    category_id=category.id,
                    name="Old retired",
                    tracking_type=TrackingType.POOL,
                    quantity=3,
                    active=False,
                ),
            ]
        )
        await db_session.flush()

        report = await ReportsService(db_session).generate_report(
            org, "inventory_status"
        )

        rows = {e["name"]: e for e in report["entries"]}
        assert set(rows) == {"Gloves M", "Gloves L"}
        assert rows["Gloves M"]["available_quantity"] == 6
        assert rows["Gloves M"]["total_quantity"] == 10
        assert rows["Gloves L"]["available_quantity"] == 0
        assert rows["Gloves L"]["total_quantity"] == 10

    async def test_a_filter_of_the_wrong_shape_is_ignored(self, db_session):
        org = await _org(db_session)

        report = await ReportsService(db_session).generate_report(
            org, "inventory_status", filters={"item_type": ["uniform"]}
        )

        assert report["total_items"] == 0


class TestRoster:
    async def test_joined_is_the_hire_date(self, db_session):
        org = await _org(db_session)
        await _member(db_session, org, "Veteran", hire=date(2004, 3, 1))

        report = await ReportsService(db_session).generate_report(org, "member_roster")

        assert [m["joined_date"] for m in report["members"]] == ["2004-03-01"]


class TestPipelineFilter:
    async def test_a_pipeline_id_of_the_wrong_shape_is_ignored(self, db_session):
        org = await _org(db_session)

        report = await ReportsService(db_session).generate_report(
            org, "pipeline_overview", filters={"pipeline_id": {"a": 1}}
        )

        assert report["report_type"] == "pipeline_overview"
