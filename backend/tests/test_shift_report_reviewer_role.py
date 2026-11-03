"""The department's reviewer role may review shift reports.

Owner decision 2026-10-31 (KNOWN_LIMITATIONS, "Scheduling — Settings That Do
Nothing", item 2): ``report_review_role`` was saved and read by nothing.
Holders of the chosen role now review reports in addition to
``training.manage`` holders, only while review is required, and never a
report about themselves.
"""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import shift_completion as endpoint
from app.schemas.shift_completion import BatchReviewRequest, ReportReview
from app.services.shift_completion_service import ShiftCompletionService
from app.services.training_module_config_service import TrainingModuleConfigService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


def _member(user_id, org_id, slugs=(), permissions=(), rank=None):
    positions = [
        SimpleNamespace(slug=slug, permissions=list(permissions)) for slug in slugs
    ]
    return SimpleNamespace(
        id=user_id,
        organization_id=org_id,
        positions=positions,
        roles=positions,
        rank=rank,
        full_name="Casey Captain",
        username="casey",
    )


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id, officer_id, trainee_id, captain_id = _uid(), _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    for uid, uname in [
        (officer_id, "lt1"),
        (trainee_id, "probie1"),
        (captain_id, "capt1"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'A', 'B', :em, 'hashed', 'active')"
            ),
            {"id": uid, "org": org_id, "un": uname, "em": f"{uname}@test.com"},
        )
    await db_session.flush()
    service = ShiftCompletionService(db_session)

    async def report(trainee):
        created = await service.create_report(
            organization_id=uuid.UUID(org_id),
            officer_id=uuid.UUID(officer_id),
            trainee_id=trainee,
            shift_date=date.today(),
            hours_on_shift=12.0,
            review_status="pending_review",
        )
        await db_session.flush()
        return created

    await TrainingModuleConfigService(db_session).update_config(
        org_id, report_review_required=True, report_review_role="captain"
    )
    return {
        "db": db_session,
        "org_id": org_id,
        "trainee_id": trainee_id,
        "captain_id": captain_id,
        "report": report,
    }


class TestReviewerRole:
    async def test_the_chosen_role_works_the_queue_and_approves(self, dept):
        db = dept["db"]
        pending = await dept["report"](dept["trainee_id"])
        captain = _member(dept["captain_id"], dept["org_id"], slugs=["captain"])

        assert await endpoint.require_report_reviewer(db=db, current_user=captain)
        queue = await endpoint.get_pending_review_reports(db=db, current_user=captain)
        assert [r.id for r in queue] == [pending.id]
        seen = await endpoint.get_shift_report(pending.id, db=db, current_user=captain)
        assert seen.id == pending.id

        reviewed = await endpoint.review_report(
            pending.id,
            ReportReview(review_status="approved"),
            db=db,
            current_user=captain,
        )
        assert reviewed.review_status == "approved"
        assert reviewed.reviewed_by == dept["captain_id"]

    async def test_chief_reaches_the_chief_positions_and_a_rank(self, dept):
        db = dept["db"]
        await TrainingModuleConfigService(db).update_config(
            dept["org_id"], report_review_role="chief"
        )
        deputy = _member(dept["captain_id"], dept["org_id"], slugs=["deputy_chief"])
        ranked = _member(dept["captain_id"], dept["org_id"], rank="fire_chief")

        assert await endpoint._reviews_by_role(db, deputy)
        assert await endpoint._reviews_by_role(db, ranked)

    async def test_another_role_is_refused(self, dept):
        lieutenant = _member(dept["captain_id"], dept["org_id"], slugs=["lieutenant"])

        with pytest.raises(HTTPException) as refused:
            await endpoint.require_report_reviewer(
                db=dept["db"], current_user=lieutenant
            )
        assert refused.value.status_code == 403

    async def test_the_role_means_nothing_with_review_off(self, dept):
        db = dept["db"]
        await TrainingModuleConfigService(db).update_config(
            dept["org_id"], report_review_required=False
        )
        captain = _member(dept["captain_id"], dept["org_id"], slugs=["captain"])

        with pytest.raises(HTTPException):
            await endpoint.require_report_reviewer(db=db, current_user=captain)
        access = await endpoint.get_review_access(db=db, current_user=captain)
        assert access == {"can_review": False, "by_role": False}

    async def test_a_role_reviewer_does_not_review_a_report_about_themselves(
        self, dept
    ):
        db = dept["db"]
        own = await dept["report"](dept["captain_id"])
        other = await dept["report"](dept["trainee_id"])
        captain = _member(dept["captain_id"], dept["org_id"], slugs=["captain"])

        queue = await endpoint.get_pending_review_reports(db=db, current_user=captain)
        assert [r.id for r in queue] == [other.id]
        with pytest.raises(HTTPException) as refused:
            await endpoint.review_report(
                own.id,
                ReportReview(review_status="approved"),
                db=db,
                current_user=captain,
            )
        assert refused.value.status_code == 403
        result = await endpoint.batch_review_reports(
            BatchReviewRequest(report_ids=[own.id], review_status="approved"),
            db=db,
            current_user=captain,
        )
        assert result == {"reviewed": 0, "failed": 1}

    async def test_training_managers_keep_their_access(self, dept):
        manager = _member(
            dept["captain_id"],
            dept["org_id"],
            slugs=["lieutenant"],
            permissions=["training.manage"],
        )
        access = await endpoint.get_review_access(db=dept["db"], current_user=manager)
        assert access == {"can_review": True, "by_role": False}
