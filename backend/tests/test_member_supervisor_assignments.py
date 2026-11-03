"""Who a member reports to (``member_supervisor_assignments``).

The rules are properties of the rows -- one open assignment per member, dated
ranges that never overlap, nothing across departments -- so almost all of
this runs against MySQL. The concurrency test uses two real, independently
committing sessions: the savepoint ``db_session`` fixture never commits, so it
cannot show what a second transaction sees.
"""

import asyncio
import importlib.util
import uuid
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError

from app.core.database import database_manager
from app.models.member_supervisor import MemberSupervisorAssignment
from app.models.user import Organization, Position, User, UserStatus, user_positions
from app.schemas.member_supervisor import (
    SupervisorAssignmentEnd,
    SupervisorAssignmentSet,
)
from app.services.member_supervisor_service import MemberSupervisorService
from app.utils.org_timezone import org_today

EVALUATOR_PERMISSION = "evaluations.evaluate"


async def _org(db):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Supervisor Test Department",
        slug=f"sup-{uuid.uuid4().hex[:8]}",
        organization_type="fire_department",
        # UTC, so the department's today is the date the fixtures expect.
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, *, status=UserStatus.ACTIVE, last="Member", deleted=False):
    name = f"u{uuid.uuid4().hex[:8]}"
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=name,
        email=f"{name}@sup.test",
        first_name="Test",
        last_name=last,
        password_hash="x",
        status=status,
    )
    db.add(user)
    await db.flush()
    if deleted:
        await db.execute(
            text("UPDATE users SET deleted_at = NOW() WHERE id = :id"), {"id": user.id}
        )
    return user


async def _grant(db, org, user, permissions):
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Position {uuid.uuid4().hex[:6]}",
        slug=f"pos-{uuid.uuid4().hex[:8]}",
        permissions=permissions,
    )
    db.add(position)
    await db.flush()
    await db.execute(
        insert(user_positions).values(user_id=user.id, position_id=position.id)
    )
    await db.flush()


def _caller(org, user_id=None):
    return SimpleNamespace(
        id=user_id or str(uuid.uuid4()),
        organization_id=org.id,
        username="officer",
        rank=None,
        positions=[SimpleNamespace(permissions=["*"])],
    )


async def _rows(db, member):
    return await MemberSupervisorService(db).list_assignments(
        member.organization_id, member.id
    )


# ----------------------------------------------------------------------
# Service rules
# ----------------------------------------------------------------------


@pytest.mark.integration
class TestSetAndChange:
    async def test_first_assignment_is_open_from_the_given_date(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        start = org_today(org) - timedelta(days=30)

        change = await MemberSupervisorService(db_session).set_supervisor(
            org.id, member.id, chief.id, starts_on=start, actor_id=chief.id
        )

        assert change.previous_supervisor_id is None
        assert change.closed_assignment_id is None
        rows = await _rows(db_session, member)
        assert [(r.supervisor_id, r.starts_on, r.ends_on) for r in rows] == [
            (chief.id, start, None)
        ]
        assert rows[0].created_by == chief.id

    async def test_start_defaults_to_the_departments_today(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)

        change = await MemberSupervisorService(db_session).set_supervisor(
            org.id, member.id, chief.id, starts_on=None, actor_id=None
        )

        assert change.assignment.starts_on == org_today(org)

    async def test_a_change_closes_the_open_row_the_day_before(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        first, second = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id,
            member.id,
            first.id,
            starts_on=today - timedelta(days=60),
            actor_id=None,
        )

        change = await svc.set_supervisor(
            org.id,
            member.id,
            second.id,
            starts_on=today - timedelta(days=10),
            actor_id=None,
        )

        assert change.previous_supervisor_id == first.id
        rows = await _rows(db_session, member)
        assert [(r.supervisor_id, r.starts_on, r.ends_on) for r in rows] == [
            (second.id, today - timedelta(days=10), None),
            (first.id, today - timedelta(days=60), today - timedelta(days=11)),
        ]
        assert change.closed_assignment_id == rows[1].id

    async def test_a_change_dated_the_same_start_corrects_in_place(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        wrong, right = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id, member.id, wrong.id, starts_on=today, actor_id=None
        )

        change = await svc.set_supervisor(
            org.id, member.id, right.id, starts_on=today, actor_id=None
        )

        assert change.corrected_in_place is True
        assert change.previous_supervisor_id == wrong.id
        rows = await _rows(db_session, member)
        assert [(r.supervisor_id, r.ends_on) for r in rows] == [(right.id, None)]

    async def test_end_closes_the_open_row(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id,
            member.id,
            chief.id,
            starts_on=today - timedelta(days=5),
            actor_id=None,
        )

        ended = await svc.end_current(org.id, member.id, ends_on=None)

        assert ended.ends_on == today
        assert await svc.current_assignment(org.id, member.id) is None

    async def test_end_refuses_dates_before_the_start_or_in_the_future(
        self, db_session
    ):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id,
            member.id,
            chief.id,
            starts_on=today - timedelta(days=5),
            actor_id=None,
        )

        with pytest.raises(ValueError, match="cannot be before"):
            await svc.end_current(org.id, member.id, ends_on=today - timedelta(days=6))
        with pytest.raises(ValueError, match="future"):
            await svc.end_current(org.id, member.id, ends_on=today + timedelta(days=1))

    async def test_end_without_a_current_supervisor_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)

        with pytest.raises(ValueError, match="no current supervisor"):
            await MemberSupervisorService(db_session).end_current(
                org.id, member.id, ends_on=None
            )

    async def test_history_is_newest_first(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        people = [await _user(db_session, org) for _ in range(3)]
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        for offset, person in zip((300, 200, 100), people):
            await svc.set_supervisor(
                org.id,
                member.id,
                person.id,
                starts_on=today - timedelta(days=offset),
                actor_id=None,
            )

        rows = await _rows(db_session, member)
        assert [r.supervisor_id for r in rows] == [p.id for p in reversed(people)]
        assert [r.ends_on for r in rows] == [
            None,
            today - timedelta(days=101),
            today - timedelta(days=201),
        ]


@pytest.mark.integration
class TestRefusals:
    async def test_a_member_cannot_supervise_themselves(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)

        with pytest.raises(ValueError, match="own supervisor"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id, member.id, member.id, starts_on=None, actor_id=None
            )
        assert await _rows(db_session, member) == []

    async def test_a_supervisor_from_another_department_is_refused(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        member = await _user(db_session, org)
        outsider = await _user(db_session, other)

        with pytest.raises(ValueError, match="current member of the department"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id, member.id, outsider.id, starts_on=None, actor_id=None
            )
        assert await _rows(db_session, member) == []

    async def test_a_member_of_another_department_cannot_be_assigned(self, db_session):
        org, other = await _org(db_session), await _org(db_session)
        chief = await _user(db_session, org)
        outsider = await _user(db_session, other)

        with pytest.raises(ValueError, match="Member not found"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id, outsider.id, chief.id, starts_on=None, actor_id=None
            )

    @pytest.mark.parametrize(
        "status", [UserStatus.INACTIVE, UserStatus.RETIRED, UserStatus.ARCHIVED]
    )
    async def test_a_supervisor_who_is_not_a_current_member_is_refused(
        self, db_session, status
    ):
        org = await _org(db_session)
        member = await _user(db_session, org)
        former = await _user(db_session, org, status=status)

        with pytest.raises(ValueError, match="current member of the department"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id, member.id, former.id, starts_on=None, actor_id=None
            )

    async def test_a_probationary_supervisor_is_accepted(self, db_session):
        # Probationary is a current account status (CLAUDE.md pitfall #32).
        org = await _org(db_session)
        member = await _user(db_session, org)
        probie = await _user(db_session, org, status=UserStatus.PROBATIONARY)

        change = await MemberSupervisorService(db_session).set_supervisor(
            org.id, member.id, probie.id, starts_on=None, actor_id=None
        )
        assert change.assignment.supervisor_id == probie.id

    async def test_a_deleted_supervisor_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        gone = await _user(db_session, org, deleted=True)

        with pytest.raises(ValueError, match="current member"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id, member.id, gone.id, starts_on=None, actor_id=None
            )

    async def test_the_same_supervisor_again_is_refused(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        svc = MemberSupervisorService(db_session)
        today = org_today(org)
        await svc.set_supervisor(
            org.id,
            member.id,
            chief.id,
            starts_on=today - timedelta(days=3),
            actor_id=None,
        )

        with pytest.raises(ValueError, match="already reports"):
            await svc.set_supervisor(
                org.id, member.id, chief.id, starts_on=today, actor_id=None
            )

    async def test_a_start_in_the_future_is_refused(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)

        with pytest.raises(ValueError, match="future"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id,
                member.id,
                chief.id,
                starts_on=org_today(org) + timedelta(days=1),
                actor_id=None,
            )

    async def test_a_change_before_the_open_start_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        first, second = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id,
            member.id,
            first.id,
            starts_on=today - timedelta(days=5),
            actor_id=None,
        )

        with pytest.raises(ValueError, match="on or after"):
            await svc.set_supervisor(
                org.id,
                member.id,
                second.id,
                starts_on=today - timedelta(days=6),
                actor_id=None,
            )

    async def test_a_start_overlapping_an_ended_assignment_is_refused(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        first, second = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id,
            member.id,
            first.id,
            starts_on=today - timedelta(days=10),
            actor_id=None,
        )
        await svc.end_current(org.id, member.id, ends_on=today - timedelta(days=2))

        with pytest.raises(ValueError, match="must be after"):
            await svc.set_supervisor(
                org.id,
                member.id,
                second.id,
                starts_on=today - timedelta(days=2),
                actor_id=None,
            )
        change = await svc.set_supervisor(
            org.id,
            member.id,
            second.id,
            starts_on=today - timedelta(days=1),
            actor_id=None,
        )
        assert change.closed_assignment_id is None


@pytest.mark.integration
class TestDatabaseGuarantees:
    async def test_the_database_refuses_a_second_open_row(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        a, b = await _user(db_session, org), await _user(db_session, org)
        today = org_today(org)
        db_session.add(
            MemberSupervisorAssignment(
                organization_id=org.id,
                member_id=member.id,
                supervisor_id=a.id,
                starts_on=today - timedelta(days=9),
            )
        )
        await db_session.flush()

        nested = await db_session.begin_nested()
        db_session.add(
            MemberSupervisorAssignment(
                organization_id=org.id,
                member_id=member.id,
                supervisor_id=b.id,
                starts_on=today,
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await nested.rollback()

    async def test_any_number_of_closed_rows_are_allowed(self, db_session):
        org = await _org(db_session)
        member = await _user(db_session, org)
        chief = await _user(db_session, org)
        today = org_today(org)
        for offset in (30, 20, 10):
            db_session.add(
                MemberSupervisorAssignment(
                    organization_id=org.id,
                    member_id=member.id,
                    supervisor_id=chief.id,
                    starts_on=today - timedelta(days=offset),
                    ends_on=today - timedelta(days=offset - 5),
                )
            )
        await db_session.flush()
        assert len(await _rows(db_session, member)) == 3

    async def test_a_removed_supervisor_leaves_the_dates_and_no_current(
        self, db_session
    ):
        # SET NULL: the member's history keeps its dates when the officer's
        # account is hard-deleted, and they read as having no supervisor now.
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        replacement = await _user(db_session, org)
        svc = MemberSupervisorService(db_session)
        today = org_today(org)
        await svc.set_supervisor(
            org.id,
            member.id,
            chief.id,
            starts_on=today - timedelta(days=3),
            actor_id=None,
        )
        await db_session.execute(
            text("DELETE FROM users WHERE id = :id"), {"id": chief.id}
        )
        org_id, member_id, replacement_id = org.id, member.id, replacement.id
        db_session.expire_all()

        rows = await svc.list_assignments(org_id, member_id)
        assert [(r.supervisor_id, r.ends_on) for r in rows] == [(None, None)]
        orphan_id = rows[0].id
        assert (
            await svc.default_evaluator_id(org_id, member_id, EVALUATOR_PERMISSION)
            is None
        )
        # And a new supervisor can still be named; the orphaned row is closed.
        change = await svc.set_supervisor(
            org_id, member_id, replacement_id, starts_on=today, actor_id=None
        )
        assert change.closed_assignment_id == orphan_id

    async def test_deleting_the_member_removes_their_history(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        await MemberSupervisorService(db_session).set_supervisor(
            org.id, member.id, chief.id, starts_on=None, actor_id=None
        )
        await db_session.execute(
            text("DELETE FROM users WHERE id = :id"), {"id": member.id}
        )

        remaining = await db_session.scalar(
            select(MemberSupervisorAssignment.id).where(
                MemberSupervisorAssignment.member_id == member.id
            )
        )
        assert remaining is None


# ----------------------------------------------------------------------
# Evaluator default
# ----------------------------------------------------------------------


@pytest.mark.integration
class TestDefaultEvaluator:
    async def test_the_current_supervisor_with_the_permission_is_the_default(
        self, db_session
    ):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        await _grant(db_session, org, chief, [EVALUATOR_PERMISSION])
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id, member.id, chief.id, starts_on=None, actor_id=None
        )

        assert (
            await svc.default_evaluator_id(org.id, member.id, EVALUATOR_PERMISSION)
            == chief.id
        )

    async def test_a_wildcard_grant_counts(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        await _grant(db_session, org, chief, ["evaluations.*"])
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id, member.id, chief.id, starts_on=None, actor_id=None
        )

        assert (
            await svc.default_evaluator_id(org.id, member.id, EVALUATOR_PERMISSION)
            == chief.id
        )

    async def test_a_supervisor_without_the_permission_is_not_the_default(
        self, db_session
    ):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        await _grant(db_session, org, chief, ["members.view"])
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id, member.id, chief.id, starts_on=None, actor_id=None
        )

        assert (
            await svc.default_evaluator_id(org.id, member.id, EVALUATOR_PERMISSION)
            is None
        )

    async def test_no_current_supervisor_means_no_default(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        await _grant(db_session, org, chief, [EVALUATOR_PERMISSION])
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id,
            member.id,
            chief.id,
            starts_on=org_today(org) - timedelta(days=3),
            actor_id=None,
        )
        await svc.end_current(org.id, member.id, ends_on=None)

        assert (
            await svc.default_evaluator_id(org.id, member.id, EVALUATOR_PERMISSION)
            is None
        )

    async def test_a_supervisor_who_has_since_left_is_not_the_default(self, db_session):
        org = await _org(db_session)
        member, chief = await _user(db_session, org), await _user(db_session, org)
        await _grant(db_session, org, chief, [EVALUATOR_PERMISSION])
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(
            org.id, member.id, chief.id, starts_on=None, actor_id=None
        )
        chief.status = UserStatus.RETIRED
        await db_session.flush()

        assert (
            await svc.default_evaluator_id(org.id, member.id, EVALUATOR_PERMISSION)
            is None
        )


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------


@pytest.mark.integration
class TestEndpoints:
    async def test_set_change_end_and_read(self, db_session, monkeypatch):
        from app.api.v1.endpoints import member_supervisors as ep

        audits = []

        async def _audit(**kwargs):
            audits.append(kwargs)

        monkeypatch.setattr(ep, "log_audit_event", _audit)
        org = await _org(db_session)
        member = await _user(db_session, org)
        first = await _user(db_session, org, last="Alpha")
        second = await _user(db_session, org, last="Bravo")
        officer = await _user(db_session, org)
        caller = _caller(org, officer.id)
        today = org_today(org)

        result = await ep.set_member_supervisor(
            member.id,
            SupervisorAssignmentSet(
                supervisor_id=first.id, starts_on=today - timedelta(days=20)
            ),
            db=db_session,
            current_user=caller,
        )
        assert result.current is not None
        assert result.current.supervisor_id == first.id
        assert result.current.supervisor_name == "Test Alpha"

        result = await ep.set_member_supervisor(
            member.id,
            SupervisorAssignmentSet(supervisor_id=second.id),
            db=db_session,
            current_user=caller,
        )
        assert result.current is not None
        assert result.current.supervisor_id == second.id
        assert [h.supervisor_id for h in result.history] == [second.id, first.id]
        assert result.history[1].ends_on == today - timedelta(days=1)

        result = await ep.end_member_supervisor(
            member.id, SupervisorAssignmentEnd(), db=db_session, current_user=caller
        )
        assert result.current is None
        assert result.history[0].ends_on == today

        assert [a["event_type"] for a in audits] == [
            "member_supervisor_set",
            "member_supervisor_set",
            "member_supervisor_ended",
        ]
        assert audits[1]["event_data"]["previous_supervisor_id"] == first.id
        assert audits[2]["event_data"]["supervisor_id"] == second.id

    async def test_a_refusal_is_a_400(self, db_session):
        from app.api.v1.endpoints import member_supervisors as ep

        org = await _org(db_session)
        member = await _user(db_session, org)

        with pytest.raises(HTTPException) as exc:
            await ep.set_member_supervisor(
                member.id,
                SupervisorAssignmentSet(supervisor_id=member.id),
                db=db_session,
                current_user=_caller(org),
            )
        assert exc.value.status_code == 400
        assert "own supervisor" in exc.value.detail

    async def test_a_member_reads_their_own(self, db_session, monkeypatch):
        from app.api.v1.endpoints import member_supervisors as ep

        org = await _org(db_session)
        member = await _user(db_session, org)
        monkeypatch.setattr(ep, "user_has_permission", lambda *_: False)

        result = await ep.get_member_supervisor(
            member.id, db=db_session, current_user=_caller(org, member.id)
        )
        assert result.current is None
        assert result.history == []

    async def test_a_colleague_without_members_manage_is_refused(
        self, db_session, monkeypatch
    ):
        from app.api.v1.endpoints import member_supervisors as ep

        org = await _org(db_session)
        member = await _user(db_session, org)
        monkeypatch.setattr(ep, "user_has_permission", lambda *_: False)

        with pytest.raises(HTTPException) as exc:
            await ep.get_member_supervisor(
                member.id, db=db_session, current_user=_caller(org)
            )
        assert exc.value.status_code == 403

    async def test_another_departments_member_is_not_found(self, db_session):
        from app.api.v1.endpoints import member_supervisors as ep

        org, other = await _org(db_session), await _org(db_session)
        outsider = await _user(db_session, other)
        chief = await _user(db_session, org)
        caller = _caller(org)

        for call in (
            ep.get_member_supervisor(outsider.id, db=db_session, current_user=caller),
            ep.list_supervisor_candidates(
                outsider.id, db=db_session, current_user=caller
            ),
            ep.set_member_supervisor(
                outsider.id,
                SupervisorAssignmentSet(supervisor_id=chief.id),
                db=db_session,
                current_user=caller,
            ),
            ep.end_member_supervisor(
                outsider.id,
                SupervisorAssignmentEnd(),
                db=db_session,
                current_user=caller,
            ),
        ):
            with pytest.raises(HTTPException) as exc:
                await call
            assert exc.value.status_code == 404

    async def test_candidates_are_current_members_other_than_the_member(
        self, db_session
    ):
        from app.api.v1.endpoints import member_supervisors as ep

        org, other = await _org(db_session), await _org(db_session)
        member = await _user(db_session, org, last="Member")
        active = await _user(db_session, org, last="Active")
        probie = await _user(
            db_session, org, last="Probie", status=UserStatus.PROBATIONARY
        )
        await _user(db_session, org, last="Retired", status=UserStatus.RETIRED)
        await _user(db_session, org, last="Deleted", deleted=True)
        await _user(db_session, other, last="Elsewhere")

        result = await ep.list_supervisor_candidates(
            member.id, db=db_session, current_user=_caller(org)
        )

        assert [c.id for c in result.candidates] == [active.id, probie.id]


# ----------------------------------------------------------------------
# Concurrency -- real commits
# ----------------------------------------------------------------------


async def _make_people():
    async with database_manager.session_factory() as session:
        org = Organization(
            name="Supervisor Race Test VFD",
            slug=f"suprace-{uuid.uuid4().hex[:12]}",
            organization_type="fire_department",
            timezone="UTC",
        )
        session.add(org)
        await session.flush()
        ids = []
        for name in ("member", "old", "a", "b"):
            username = f"{name}{uuid.uuid4().hex[:8]}"
            user = User(
                organization_id=org.id,
                username=username,
                email=f"{username}@suprace.test",
                first_name="Test",
                last_name=name.title(),
                password_hash="x",
                status=UserStatus.ACTIVE,
            )
            session.add(user)
            await session.flush()
            ids.append(user.id)
        session.add(
            MemberSupervisorAssignment(
                organization_id=org.id,
                member_id=ids[0],
                supervisor_id=ids[1],
                starts_on=org_today(org) - timedelta(days=30),
            )
        )
        await session.commit()
        return org.id, ids


async def _cleanup(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        for table in ("member_supervisor_assignments", "users"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = :o"), {"o": org_id}
            )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
        )
        await session.commit()


@pytest.mark.integration
@pytest.mark.usefixtures("_initialize_database")
class TestConcurrentChange:
    async def test_two_simultaneous_changes_leave_one_open_assignment(self):
        org_id, (member_id, old_id, a_id, b_id) = await _make_people()
        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            # Pin both REPEATABLE READ snapshots before either change starts,
            # so each would see the original open row were the reads not
            # locking ones.
            for session in (session_a, session_b):
                await session.execute(
                    select(MemberSupervisorAssignment.id).where(
                        MemberSupervisorAssignment.member_id == member_id
                    )
                )

            async def change(session, supervisor_id):
                await MemberSupervisorService(session).set_supervisor(
                    org_id, member_id, supervisor_id, starts_on=None, actor_id=None
                )
                await session.commit()

            outcomes = await asyncio.gather(
                change(session_a, a_id),
                change(session_b, b_id),
                return_exceptions=True,
            )
            assert outcomes == [None, None], outcomes

            async with database_manager.session_factory() as check:
                rows = await MemberSupervisorService(check).list_assignments(
                    org_id, member_id
                )
            open_rows = [r for r in rows if r.ends_on is None]
            assert len(open_rows) == 1
            assert open_rows[0].supervisor_id in {a_id, b_id}
            # The first change closed the old row; the second, dated the same
            # day, corrected the new one in place rather than adding a third.
            assert len(rows) == 2
            closed = [r for r in rows if r.ends_on is not None]
            assert [r.supervisor_id for r in closed] == [old_id]
        finally:
            await session_a.close()
            await session_b.close()
            await _cleanup(org_id)


# ----------------------------------------------------------------------
# Migration
# ----------------------------------------------------------------------

MIGRATION = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_a1c3e5f7b9d2_*.py"
    )
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("_supervisor_migration", MIGRATION)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
class TestMigrationSource:
    def test_revision_ids(self):
        module = _load_migration()
        assert module.revision == "a1c3e5f7b9d2"
        assert module.down_revision == "e15d635bbb98"

    def test_open_marker_expression_matches_the_model(self):
        from app.models.member_supervisor import OPEN_MARKER_EXPRESSION

        assert _load_migration()._OPEN_MARKER_EXPRESSION == OPEN_MARKER_EXPRESSION


@pytest.mark.integration
class TestMigrationRuns:
    def test_upgrade_is_guarded_and_downgrade_drops(self):
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from sqlalchemy import create_engine, inspect

        from app.core.config import settings
        from app.core.database import Base

        module = _load_migration()
        table = module.TABLE
        engine = create_engine(settings.SYNC_DATABASE_URL)

        def run(conn, step):
            with Operations.context(MigrationContext.configure(conn)):
                step()
            conn.commit()

        try:
            with engine.connect() as conn:
                if not inspect(conn).has_table("users"):
                    pytest.skip("users is not present in the test database")
                if not inspect(conn).has_table(table):
                    run(conn, module.upgrade)

                # Present already: the upgrade leaves it alone.
                before = conn.exec_driver_sql(f"SHOW CREATE TABLE {table}").one()[1]
                run(conn, module.upgrade)
                assert (
                    conn.exec_driver_sql(f"SHOW CREATE TABLE {table}").one()[1]
                    == before
                )

                run(conn, module.downgrade)
                assert not inspect(conn).has_table(table)
                # Twice is harmless: DROP TABLE IF EXISTS.
                run(conn, module.downgrade)

                run(conn, module.upgrade)
                assert inspect(conn).has_table(table)
                uniques = {
                    u["name"]: u["column_names"]
                    for u in inspect(conn).get_unique_constraints(table)
                }
                assert uniques["uq_member_supervisor_assignments_open"] == [
                    "member_id",
                    "open_marker",
                ]
                indexed = {
                    tuple(i["column_names"]) for i in inspect(conn).get_indexes(table)
                }
                assert ("organization_id", "member_id", "starts_on") in indexed
        finally:
            # Never leave the shared test database without the table; MySQL
            # DDL does not roll back.
            with engine.connect() as conn:
                if not inspect(conn).has_table(table):
                    Base.metadata.tables[table].create(conn)
                    conn.commit()
            engine.dispose()

    def test_the_migrated_table_matches_create_all(self):
        """The migration and the model build the same columns."""
        from sqlalchemy import create_engine, inspect

        from app.core.config import settings
        from app.core.database import Base

        model_columns = {
            c.name
            for c in Base.metadata.tables["member_supervisor_assignments"].columns
        }
        engine = create_engine(settings.SYNC_DATABASE_URL)
        try:
            with engine.connect() as conn:
                if not inspect(conn).has_table("member_supervisor_assignments"):
                    pytest.skip("table not present")
                live = {
                    c["name"]
                    for c in inspect(conn).get_columns("member_supervisor_assignments")
                }
        finally:
            engine.dispose()
        assert live == model_columns
