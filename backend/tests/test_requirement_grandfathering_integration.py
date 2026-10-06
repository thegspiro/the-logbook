"""
Grandfathering against a real database: a requirement a new chief adds must
leave the existing roster in good standing and hold new members to it.

Covers the screens that decide standing (compliance matrix, dashboard
percentage, a member's applicable requirements) and the update endpoint's two
grandfathering paths — editing the cutoff in place and a "new members only"
split — including the audit entries both must leave.
"""

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.training import get_compliance_matrix, update_requirement
from app.models.audit import AuditLog
from app.models.training import TrainingRequirement
from app.models.user import User
from app.schemas.training import TrainingRequirementUpdate
from app.services.training_compliance import CATCH_UP_STATUS, compute_org_compliance_pct
from app.services.training_service import TrainingService

pytestmark = [pytest.mark.integration]

_NOW = datetime.now(timezone.utc)
TODAY = date.today()
CUTOFF = TODAY - timedelta(days=10)
VETERAN_HIRED = TODAY - timedelta(days=3650)
RECRUIT_HIRED = TODAY - timedelta(days=2)


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Grandfather Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"gf-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _insert_member(db: AsyncSession, org_id: str, last_name: str, hired) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status, membership_type, compliance_exempt, hire_date) "
            "VALUES (:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active', "
            "'active', 0, :hired)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "ln": last_name,
            "em": f"u-{user_id[:8]}@test.com",
            "hired": hired,
        },
    )
    await db.flush()
    return user_id


async def _insert_cert_req(
    db: AsyncSession,
    org_id: str,
    name: str,
    *,
    cutoff=None,
    deadline=None,
) -> str:
    req_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, frequency, "
            "due_date_type, period_start_month, period_start_day, applies_to_all, "
            "active, new_member_cutoff_date, existing_member_deadline, "
            "created_at, updated_at) "
            "VALUES (:id, :org, :name, 'certification', 'department', 'one_time', "
            "'calendar_period', 1, 1, 1, 1, :cutoff, :deadline, :now, :now)"
        ),
        {
            "id": req_id,
            "org": org_id,
            "name": name,
            "cutoff": cutoff,
            "deadline": deadline,
            "now": _NOW,
        },
    )
    await db.flush()
    return req_id


async def _insert_hours_req(db: AsyncSession, org_id: str, name: str) -> str:
    req_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_requirements "
            "(id, organization_id, name, requirement_type, source, required_hours, "
            "frequency, due_date_type, period_start_month, period_start_day, "
            "applies_to_all, required_membership_types, active, created_at, "
            "updated_at) "
            "VALUES (:id, :org, :name, 'hours', 'department', 24, 'annual', "
            "'calendar_period', 1, 1, 0, :mt, 1, :now, :now)"
        ),
        {
            "id": req_id,
            "org": org_id,
            "name": name,
            "mt": json.dumps(["active"]),
            "now": _NOW,
        },
    )
    await db.flush()
    return req_id


async def _caller(db: AsyncSession, org_id: str) -> User:
    user_id = await _insert_member(db, org_id, "Chief", VETERAN_HIRED)
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one()


def _rows_by_name(payload: dict) -> dict:
    return {m["member_name"].split(",")[0]: m for m in payload["members"]}


class TestExemptExistingMembers:
    async def test_matrix_holds_only_new_members_to_it(self, db_session):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        await _insert_member(db_session, org_id, "Recruit", RECRUIT_HIRED)
        req_id = await _insert_cert_req(db_session, org_id, "Live Fire", cutoff=CUTOFF)
        caller = User(id=_uid(), organization_id=org_id)

        rows = _rows_by_name(
            await get_compliance_matrix(db=db_session, current_user=caller)
        )

        assert rows["Veteran"]["requirements"] == []
        assert rows["Veteran"]["standing"] == "not_applicable"
        assert rows["Veteran"]["completion_pct"] is None
        recruit_cells = rows["Recruit"]["requirements"]
        assert [c["requirement_id"] for c in recruit_cells] == [req_id]
        assert recruit_cells[0]["status"] == "not_started"
        assert rows["Recruit"]["standing"] == "non_compliant"

    async def test_dashboard_percentage_agrees(self, db_session):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        await _insert_member(db_session, org_id, "Recruit", RECRUIT_HIRED)
        await _insert_cert_req(db_session, org_id, "Live Fire", cutoff=CUTOFF)

        # The veteran is not applicable and outside the percentage (TR4-4):
        # one graded member, not compliant.
        assert await compute_org_compliance_pct(db_session, org_id) == 0.0

    async def test_my_training_list_omits_it_for_a_veteran(self, db_session):
        org_id = await _insert_org(db_session)
        veteran = await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        recruit = await _insert_member(db_session, org_id, "Recruit", RECRUIT_HIRED)
        req_id = await _insert_cert_req(db_session, org_id, "Live Fire", cutoff=CUTOFF)
        svc = TrainingService(db_session)

        veteran_reqs = await svc.get_applicable_requirements(veteran, org_id)
        recruit_reqs = await svc.get_applicable_requirements(recruit, org_id)

        assert req_id not in {str(r.id) for r in veteran_reqs}
        assert req_id in {str(r.id) for r in recruit_reqs}


class TestCatchUpDeadline:
    async def test_matrix_shows_the_deadline_and_does_not_count_it(self, db_session):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        deadline = TODAY + timedelta(days=30)
        await _insert_cert_req(
            db_session, org_id, "Live Fire", cutoff=CUTOFF, deadline=deadline
        )
        caller = User(id=_uid(), organization_id=org_id)

        veteran = _rows_by_name(
            await get_compliance_matrix(db=db_session, current_user=caller)
        )["Veteran"]

        cell = veteran["requirements"][0]
        assert cell["status"] == CATCH_UP_STATUS
        assert cell["catch_up_deadline"] == deadline.isoformat()
        assert veteran["requirements_total"] == 0
        # Every requirement is still in catch-up, so nothing grades them yet.
        assert veteran["standing"] == "not_applicable"

    async def test_counts_once_the_deadline_has_passed(self, db_session):
        org_id = await _insert_org(db_session)
        await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        await _insert_cert_req(
            db_session,
            org_id,
            "Live Fire",
            cutoff=CUTOFF,
            deadline=TODAY - timedelta(days=1),
        )

        assert await compute_org_compliance_pct(db_session, org_id) == 0.0

    async def test_progress_endpoint_reports_the_deadline_as_due(self, db_session):
        org_id = await _insert_org(db_session)
        veteran = await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        deadline = TODAY + timedelta(days=30)
        await _insert_cert_req(
            db_session, org_id, "Live Fire", cutoff=CUTOFF, deadline=deadline
        )

        progress = await TrainingService(db_session).get_all_requirements_progress(
            veteran, org_id
        )

        assert len(progress) == 1
        assert progress[0].catch_up_deadline == deadline
        assert progress[0].due_date == deadline


class TestUpdateEndpoint:
    async def _audit_events(self, db, requirement_id: str) -> list[AuditLog]:
        rows = (
            await db.execute(
                select(AuditLog).where(
                    AuditLog.event_type.like("training_requirement_%")
                )
            )
        ).scalars()
        return [r for r in rows if r.event_data.get("requirement_id") == requirement_id]

    async def test_new_members_only_splits_and_audits(self, db_session):
        org_id = await _insert_org(db_session)
        caller = await _caller(db_session, org_id)
        await _insert_member(db_session, org_id, "Veteran", VETERAN_HIRED)
        await _insert_member(db_session, org_id, "Recruit", RECRUIT_HIRED)
        original_id = await _insert_hours_req(db_session, org_id, "Annual Hours")

        copy_ = await update_requirement(
            requirement_id=uuid.UUID(original_id),
            requirement_update=TrainingRequirementUpdate(
                required_hours=36,
                apply_to="new_members_only",
                effective_date=CUTOFF,
            ),
            db=db_session,
            current_user=caller,
        )

        original = await db_session.get(TrainingRequirement, original_id)
        assert original.required_hours == 24
        assert original.applies_to_joined_before == CUTOFF
        assert str(copy_.id) != original_id
        assert copy_.required_hours == 36
        assert copy_.new_member_cutoff_date == CUTOFF
        assert copy_.required_membership_types == ["active"]

        # The two standards grade disjoint groups: the veteran meets 24 hours
        # of the old standard, the recruit 36 of the new one.
        matrix = await get_compliance_matrix(db=db_session, current_user=caller)
        rows = _rows_by_name(matrix)
        veteran_req = {c["requirement_id"] for c in rows["Veteran"]["requirements"]}
        recruit_req = {c["requirement_id"] for c in rows["Recruit"]["requirements"]}
        assert veteran_req == {original_id}
        assert recruit_req == {str(copy_.id)}

        events = await self._audit_events(db_session, original_id)
        assert [e.event_type for e in events] == [
            "training_requirement_split_for_new_members"
        ]
        assert events[0].event_data["new_requirement_id"] == str(copy_.id)
        assert events[0].event_data["after"]["applies_to_joined_before"] == (
            CUTOFF.isoformat()
        )

    async def test_second_split_of_the_earlier_standard_is_refused(self, db_session):
        org_id = await _insert_org(db_session)
        caller = await _caller(db_session, org_id)
        original_id = await _insert_hours_req(db_session, org_id, "Annual Hours")
        update = TrainingRequirementUpdate(
            required_hours=36, apply_to="new_members_only", effective_date=CUTOFF
        )
        await update_requirement(
            requirement_id=uuid.UUID(original_id),
            requirement_update=update,
            db=db_session,
            current_user=caller,
        )

        with pytest.raises(HTTPException) as exc:
            await update_requirement(
                requirement_id=uuid.UUID(original_id),
                requirement_update=TrainingRequirementUpdate(
                    required_hours=48,
                    apply_to="new_members_only",
                    effective_date=TODAY,
                ),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 400

    async def test_editing_the_cutoff_in_place_is_audited(self, db_session):
        org_id = await _insert_org(db_session)
        caller = await _caller(db_session, org_id)
        req_id = await _insert_cert_req(db_session, org_id, "Live Fire")

        await update_requirement(
            requirement_id=uuid.UUID(req_id),
            requirement_update=TrainingRequirementUpdate(new_member_cutoff_date=CUTOFF),
            db=db_session,
            current_user=caller,
        )

        events = await self._audit_events(db_session, req_id)
        assert [e.event_type for e in events] == [
            "training_requirement_grandfathering_changed"
        ]
        assert events[0].event_data["before"]["new_member_cutoff_date"] is None
        assert events[0].event_data["after"]["new_member_cutoff_date"] == (
            CUTOFF.isoformat()
        )

    async def test_an_ordinary_edit_writes_no_grandfathering_audit(self, db_session):
        org_id = await _insert_org(db_session)
        caller = await _caller(db_session, org_id)
        req_id = await _insert_cert_req(db_session, org_id, "Live Fire")

        await update_requirement(
            requirement_id=uuid.UUID(req_id),
            requirement_update=TrainingRequirementUpdate(name="Live Fire II"),
            db=db_session,
            current_user=caller,
        )

        assert await self._audit_events(db_session, req_id) == []

    async def test_a_deadline_without_a_cutoff_is_refused(self, db_session):
        org_id = await _insert_org(db_session)
        caller = await _caller(db_session, org_id)
        req_id = await _insert_cert_req(db_session, org_id, "Live Fire")

        with pytest.raises(HTTPException) as exc:
            await update_requirement(
                requirement_id=uuid.UUID(req_id),
                requirement_update=TrainingRequirementUpdate(
                    existing_member_deadline=TODAY + timedelta(days=30)
                ),
                db=db_session,
                current_user=caller,
            )
        assert exc.value.status_code == 400
