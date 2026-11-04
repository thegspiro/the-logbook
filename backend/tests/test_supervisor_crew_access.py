"""Crew views, supervisor approvals and the loop rule (owner decisions
2026-11-01, built 2026-11-04).

* **Refuse loops** -- an assignment that would make a member report, directly
  or through others, to someone they supervise on the same dates is refused,
  and two concurrent changes cannot together make one.
* **Crew views** -- a member who supervises others *today* reads their
  training standing and records, and lists them; an ended assignment, a
  colleague who supervises nobody and another department get nothing.
* **Approvals** -- a member's time-off request reaches their supervisor, who
  may decide it; scheduling officers still review every request.

Evaluations' crew access is covered beside the rest of the evaluations rules,
in ``test_evaluation_workflow.py`` (``TestCrewSupervisor``).
"""

import asyncio
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select, text

from app.core.database import database_manager
from app.models.member_supervisor import MemberSupervisorAssignment
from app.models.notification import NotificationLog
from app.models.training import (
    ShiftTimeOff,
    TimeOffStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.member_supervisor_service import MemberSupervisorService
from app.utils.org_timezone import org_today

# ----------------------------------------------------------------------
# Fixtures
# ----------------------------------------------------------------------


async def _org(db):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Crew Test Department",
        slug=f"crew-{uuid.uuid4().hex[:8]}",
        organization_type="fire_department",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    return org


async def _user(db, org, last="Member", status=UserStatus.ACTIVE):
    name = f"c{uuid.uuid4().hex[:8]}"
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=name,
        email=f"{name}@crew.test",
        first_name="Test",
        last_name=last,
        password_hash="x",
        status=status,
    )
    db.add(user)
    await db.flush()
    return user


def _caller(user, permissions=()):
    """A request's current user holding exactly ``permissions``."""
    return SimpleNamespace(
        id=user.id,
        organization_id=user.organization_id,
        username=user.username,
        rank=None,
        positions=[
            SimpleNamespace(id=str(uuid.uuid4()), permissions=list(permissions))
        ],
    )


async def _assign(db, org, member, supervisor, start, end=None):
    row = MemberSupervisorAssignment(
        organization_id=org.id,
        member_id=member.id,
        supervisor_id=supervisor.id,
        starts_on=start,
        ends_on=end,
    )
    db.add(row)
    await db.flush()
    return row


# ----------------------------------------------------------------------
# Refuse loops -- the pure walk
# ----------------------------------------------------------------------

D = date(2026, 6, 1)


@pytest.mark.unit
class TestFindLoop:
    def test_a_direct_loop(self):
        from app.services.member_supervisor_service import find_loop

        # B reports to A; making A report to B closes the loop.
        edges = [("b", "a", D, None)]
        assert find_loop(edges, "a", "b", D) == ["b", "a"]

    def test_a_longer_loop(self):
        from app.services.member_supervisor_service import find_loop

        # C reports to B, B reports to A; A under C closes A -> C -> B -> A.
        edges = [("c", "b", D, None), ("b", "a", D, None)]
        assert find_loop(edges, "a", "c", D) == ["c", "b", "a"]

    def test_a_chain_is_not_a_loop(self):
        from app.services.member_supervisor_service import find_loop

        edges = [("c", "b", D, None), ("b", "a", D, None)]
        assert find_loop(edges, "d", "c", D) is None
        assert find_loop(edges, "c", "a", D) is None

    def test_edges_on_different_dates_do_not_make_a_loop(self):
        from app.services.member_supervisor_service import find_loop

        # B reported to A until the day before; A may now report to B.
        edges = [("b", "a", D - timedelta(days=90), D - timedelta(days=1))]
        assert find_loop(edges, "a", "b", D) is None

    def test_a_longer_chain_needs_one_day_every_edge_shares(self):
        from app.services.member_supervisor_service import find_loop

        # C->B held in June only, B->A from July: never both on one day.
        edges = [
            ("c", "b", date(2026, 6, 1), date(2026, 6, 30)),
            ("b", "a", date(2026, 7, 1), None),
        ]
        assert find_loop(edges, "a", "c", date(2026, 5, 1)) is None
        edges.append(("b", "a", date(2026, 6, 15), date(2026, 6, 20)))
        assert find_loop(edges, "a", "c", date(2026, 5, 1)) == ["c", "b", "a"]

    def test_a_loop_already_in_the_data_is_stepped_over(self):
        from app.services.member_supervisor_service import find_loop

        # X and Y already supervise each other; the walk must still end.
        edges = [("x", "y", D, None), ("y", "x", D, None)]
        assert find_loop(edges, "a", "x", D) is None


# ----------------------------------------------------------------------
# Refuse loops -- the service
# ----------------------------------------------------------------------


@pytest.mark.integration
class TestRefuseLoops:
    async def test_a_direct_loop_is_refused(self, db_session):
        org = await _org(db_session)
        a = await _user(db_session, org, "Alpha")
        b = await _user(db_session, org, "Bravo")
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(org.id, b.id, a.id, starts_on=None, actor_id=None)

        with pytest.raises(ValueError, match="supervision loop") as exc:
            await svc.set_supervisor(org.id, a.id, b.id, starts_on=None, actor_id=None)

        message = str(exc.value)
        assert "supervision loop" in message
        assert "Test Alpha would report to Test Bravo, who reports to Test Alpha" in (
            message
        )
        assert await svc.list_assignments(org.id, a.id) == []

    async def test_a_longer_loop_is_refused(self, db_session):
        org = await _org(db_session)
        a = await _user(db_session, org, "A")
        b = await _user(db_session, org, "B")
        c = await _user(db_session, org, "C")
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(org.id, b.id, a.id, starts_on=None, actor_id=None)
        await svc.set_supervisor(org.id, c.id, b.id, starts_on=None, actor_id=None)

        with pytest.raises(ValueError, match="supervision loop"):
            await svc.set_supervisor(org.id, a.id, c.id, starts_on=None, actor_id=None)

    async def test_a_chain_is_accepted(self, db_session):
        org = await _org(db_session)
        a = await _user(db_session, org, "A")
        b = await _user(db_session, org, "B")
        c = await _user(db_session, org, "C")
        svc = MemberSupervisorService(db_session)
        await svc.set_supervisor(org.id, b.id, a.id, starts_on=None, actor_id=None)
        await svc.set_supervisor(org.id, c.id, b.id, starts_on=None, actor_id=None)
        # Moving C straight under A is still a tree.
        change = await svc.set_supervisor(
            org.id, c.id, a.id, starts_on=None, actor_id=None
        )
        assert change.assignment.supervisor_id == a.id

    async def test_supervising_a_former_supervisor_is_accepted(self, db_session):
        org = await _org(db_session)
        a = await _user(db_session, org, "A")
        b = await _user(db_session, org, "B")
        today = org_today(org)
        await _assign(
            db_session,
            org,
            b,
            a,
            today - timedelta(days=200),
            today - timedelta(days=31),
        )
        change = await MemberSupervisorService(db_session).set_supervisor(
            org.id, a.id, b.id, starts_on=today - timedelta(days=30), actor_id=None
        )
        assert change.assignment.supervisor_id == b.id

    async def test_a_backdated_start_meeting_an_ended_assignment_is_refused(
        self, db_session
    ):
        org = await _org(db_session)
        a = await _user(db_session, org, "A")
        b = await _user(db_session, org, "B")
        today = org_today(org)
        # B reported to A until 10 days ago; A under B from 20 days ago would
        # put each above the other for those ten days.
        await _assign(
            db_session,
            org,
            b,
            a,
            today - timedelta(days=200),
            today - timedelta(days=10),
        )
        with pytest.raises(ValueError, match="supervision loop"):
            await MemberSupervisorService(db_session).set_supervisor(
                org.id,
                a.id,
                b.id,
                starts_on=today - timedelta(days=20),
                actor_id=None,
            )

    async def test_the_endpoint_answers_400(self, db_session, monkeypatch):
        from app.api.v1.endpoints import member_supervisors as ep
        from app.schemas.member_supervisor import SupervisorAssignmentSet

        org = await _org(db_session)
        a = await _user(db_session, org, "A")
        b = await _user(db_session, org, "B")
        await _assign(db_session, org, b, a, org_today(org))

        with pytest.raises(HTTPException) as exc:
            await ep.set_member_supervisor(
                a.id,
                SupervisorAssignmentSet(supervisor_id=b.id),
                db=db_session,
                current_user=_caller(a, ["*"]),
            )
        assert exc.value.status_code == 400
        assert "supervision loop" in exc.value.detail

    async def test_existing_loops_are_reported_not_removed(self, db_session):
        org = await _org(db_session)
        a = await _user(db_session, org, "A")
        b = await _user(db_session, org, "B")
        c = await _user(db_session, org, "C")
        today = org_today(org)
        # Written straight to the table, as rows from before the rule could be.
        await _assign(db_session, org, b, a, today)
        await _assign(db_session, org, a, b, today)
        await _assign(db_session, org, c, a, today)

        svc = MemberSupervisorService(db_session)
        loops = await svc.find_existing_loops(org.id)

        assert [sorted(chain) for chain in loops] == [sorted([a.id, b.id])]
        assert len(await svc.list_assignments(org.id, a.id)) == 1
        assert len(await svc.list_assignments(org.id, b.id)) == 1


# ----------------------------------------------------------------------
# Refuse loops -- two requests at once
# ----------------------------------------------------------------------


async def _make_pair():
    async with database_manager.session_factory() as session:
        org = Organization(
            name="Loop Race Test VFD",
            slug=f"looprace-{uuid.uuid4().hex[:12]}",
            organization_type="fire_department",
            timezone="UTC",
        )
        session.add(org)
        await session.flush()
        ids = []
        for name in ("alpha", "bravo"):
            username = f"{name}{uuid.uuid4().hex[:8]}"
            user = User(
                organization_id=org.id,
                username=username,
                email=f"{username}@looprace.test",
                first_name="Test",
                last_name=name.title(),
                password_hash="x",
                status=UserStatus.ACTIVE,
            )
            session.add(user)
            await session.flush()
            ids.append(user.id)
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
class TestConcurrentLoop:
    async def test_two_simultaneous_halves_of_a_loop_cannot_both_land(self):
        org_id, (a_id, b_id) = await _make_pair()
        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            # Pin both REPEATABLE READ snapshots first, so each would miss the
            # other's committed row were the loop check a snapshot read.
            for session in (session_a, session_b):
                await session.execute(
                    select(MemberSupervisorAssignment.id).where(
                        MemberSupervisorAssignment.organization_id == org_id
                    )
                )

            async def assign(session, member_id, supervisor_id):
                await MemberSupervisorService(session).set_supervisor(
                    org_id, member_id, supervisor_id, starts_on=None, actor_id=None
                )
                await session.commit()

            outcomes = await asyncio.gather(
                assign(session_a, b_id, a_id),
                assign(session_b, a_id, b_id),
                return_exceptions=True,
            )
            refused = [o for o in outcomes if isinstance(o, ValueError)]
            assert len(refused) == 1, outcomes
            assert "supervision loop" in str(refused[0])
            assert outcomes.count(None) == 1, outcomes

            async with database_manager.session_factory() as check:
                rows = (
                    (
                        await check.execute(
                            select(MemberSupervisorAssignment).where(
                                MemberSupervisorAssignment.organization_id == org_id
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
            assert len(rows) == 1
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            await _cleanup(org_id)


# ----------------------------------------------------------------------
# Crew views
# ----------------------------------------------------------------------


class _Crew:
    def __init__(self, org, captain, member, stranger, former):
        self.org = org
        self.captain = captain
        self.member = member
        self.stranger = stranger
        self.former = former


@pytest.fixture
async def crew(db_session) -> _Crew:
    """A captain supervising a member today; a stranger supervising nobody;
    a former supervisor whose assignment ended yesterday."""
    org = await _org(db_session)
    captain = await _user(db_session, org, "Captain")
    member = await _user(db_session, org, "Member")
    stranger = await _user(db_session, org, "Stranger")
    former = await _user(db_session, org, "Former")
    today = org_today(org)
    await _assign(
        db_session,
        org,
        member,
        former,
        today - timedelta(days=100),
        today - timedelta(days=1),
    )
    await _assign(db_session, org, member, captain, today)
    return _Crew(org, captain, member, stranger, former)


@pytest.mark.integration
class TestCrewList:
    async def test_the_supervisor_lists_their_crew(self, db_session, crew):
        from app.api.v1.endpoints import member_supervisors as ep

        result = await ep.list_my_crew(db=db_session, current_user=crew.captain)

        assert [(m.id, m.name) for m in result.members] == [
            (crew.member.id, "Test Member")
        ]
        assert result.members[0].supervised_since == org_today(crew.org)

    async def test_nobody_else_has_a_crew(self, db_session, crew):
        from app.api.v1.endpoints import member_supervisors as ep

        for user in (crew.stranger, crew.former, crew.member):
            result = await ep.list_my_crew(db=db_session, current_user=user)
            assert result.members == []

    async def test_a_former_member_supervises_nobody(self, db_session, crew):
        await db_session.execute(
            text("UPDATE users SET status = 'retired' WHERE id = :id"),
            {"id": crew.captain.id},
        )
        svc = MemberSupervisorService(db_session)
        assert await svc.current_crew(crew.org.id, crew.captain.id) == []
        assert not await svc.is_current_supervisor(
            crew.org.id, crew.captain.id, crew.member.id
        )

    async def test_relationship_is_answered_inside_the_department(
        self, db_session, crew
    ):
        svc = MemberSupervisorService(db_session)
        other = await _org(db_session)
        assert await svc.is_current_supervisor(
            crew.org.id, crew.captain.id, crew.member.id
        )
        assert not await svc.is_current_supervisor(
            other.id, crew.captain.id, crew.member.id
        )
        assert not await svc.is_current_supervisor(
            crew.org.id, crew.former.id, crew.member.id
        )
        assert not await svc.is_current_supervisor(
            crew.org.id, crew.member.id, crew.captain.id
        )


@pytest.mark.integration
class TestCrewTrainingReads:
    async def test_the_supervisor_reads_the_crew_members_training(
        self, db_session, crew
    ):
        from app.api.v1.endpoints import training as ep

        stats = await ep.get_user_stats(
            uuid.UUID(crew.member.id), db=db_session, current_user=_caller(crew.captain)
        )
        assert str(stats.user_id) == crew.member.id
        summary = await ep.get_compliance_summary(
            uuid.UUID(crew.member.id), db=db_session, current_user=_caller(crew.captain)
        )
        assert str(summary.user_id) == crew.member.id

    async def test_anyone_else_is_refused(self, db_session, crew):
        from app.api.v1.endpoints import training as ep

        outsider_org = await _org(db_session)
        outsider = await _user(db_session, outsider_org, "Outsider")
        for user in (crew.stranger, crew.former, outsider):
            with pytest.raises(HTTPException) as exc:
                await ep.get_compliance_summary(
                    uuid.UUID(crew.member.id),
                    db=db_session,
                    current_user=_caller(user),
                )
            assert exc.value.status_code == 403

    async def test_the_supervisor_lists_a_crew_members_records(self, db_session, crew):
        from app.api.v1.endpoints import training as ep

        for user in (crew.member, crew.captain):
            db_session.add(
                TrainingRecord(
                    organization_id=crew.org.id,
                    user_id=user.id,
                    course_name=f"Course for {user.last_name}",
                    training_type=TrainingType.CONTINUING_EDUCATION,
                    hours_completed=2,
                    status=TrainingStatus.COMPLETED,
                    completion_date=date(2026, 1, 5),
                )
            )
        await db_session.flush()

        async def names(user):
            rows = await ep.list_records(
                Response(),
                user_id=uuid.UUID(crew.member.id),
                status=None,
                start_date=None,
                end_date=None,
                skip=0,
                limit=50,
                db=db_session,
                current_user=_caller(user),
            )
            return [r.course_name for r in rows]

        assert await names(crew.captain) == ["Course for Member"]
        # Asking for someone else's records still reads one's own, as before.
        assert await names(crew.stranger) == []


# ----------------------------------------------------------------------
# Approvals -- time off
# ----------------------------------------------------------------------


class _Outbox:
    def __init__(self):
        self.sent = []


@pytest.fixture
def outbox(monkeypatch) -> _Outbox:
    from app.services.email_service import EmailService

    box = _Outbox()

    async def _send(self, to_emails, subject, html_body, text_body=None, **kwargs):
        box.sent.append((list(to_emails), subject))
        return (len(to_emails), 0)

    monkeypatch.setattr(EmailService, "send_email", _send)
    return box


async def _request(db, crew, *, by=None):
    from app.services.scheduling_service import SchedulingService

    today = org_today(crew.org)
    time_off, error = await SchedulingService(db).create_time_off(
        crew.org.id,
        (by or crew.member).id,
        {
            "start_date": today + timedelta(days=7),
            "end_date": today + timedelta(days=9),
        },
    )
    assert error is None, error
    return time_off


@pytest.mark.integration
class TestTimeOffRoutesToTheSupervisor:
    async def test_the_supervisor_is_told_by_email_and_in_app(
        self, db_session, crew, outbox
    ):
        time_off = await _request(db_session, crew)

        notices = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == crew.org.id,
                        NotificationLog.recipient_id == crew.captain.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(notices) == 1
        assert notices[0].notification_metadata == {"time_off_id": time_off.id}
        assert outbox.sent == [([crew.captain.email], "Time-off request — Test Member")]

    async def test_no_supervisor_means_no_notice(self, db_session, crew, outbox):
        await _request(db_session, crew, by=crew.stranger)
        assert outbox.sent == []

    async def test_the_supervisor_decides_it(self, db_session, crew, outbox):
        # Over HTTP, so the route's own dependency is part of what is tested:
        # it used to demand scheduling.manage before the handler ran.
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.api.v1.endpoints import scheduling as ep
        from app.core.database import get_db

        time_off = await _request(db_session, crew)
        app = FastAPI()
        app.include_router(ep.router, prefix="/scheduling")
        app.dependency_overrides[get_current_user] = lambda: _caller(
            crew.captain, ["scheduling.view"]
        )
        app.dependency_overrides[get_db] = lambda: db_session
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/scheduling/time-off/{time_off.id}/review",
                json={"status": "approved"},
            )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "approved"
        assert response.json()["approved_by"] == crew.captain.id

    async def test_nobody_else_without_the_grant_decides_it(
        self, db_session, crew, outbox
    ):
        from app.api.v1.endpoints import scheduling as ep
        from app.schemas.scheduling import ShiftTimeOffReview

        time_off = await _request(db_session, crew)
        for user in (crew.stranger, crew.former):
            with pytest.raises(HTTPException) as exc:
                await ep.review_time_off_request(
                    uuid.UUID(time_off.id),
                    ShiftTimeOffReview(status="approved"),
                    db=db_session,
                    current_user=_caller(user, ["scheduling.view"]),
                )
            assert exc.value.status_code == 403
        row = await db_session.get(ShiftTimeOff, time_off.id)
        await db_session.refresh(row)
        assert row.status == TimeOffStatus.PENDING

    async def test_a_scheduling_officer_still_decides_it(
        self, db_session, crew, outbox
    ):
        from app.api.v1.endpoints import scheduling as ep
        from app.schemas.scheduling import ShiftTimeOffReview

        time_off = await _request(db_session, crew)
        result = await ep.review_time_off_request(
            uuid.UUID(time_off.id),
            ShiftTimeOffReview(status="denied"),
            db=db_session,
            current_user=_caller(crew.stranger, ["scheduling.manage"]),
        )
        assert result["status"] == TimeOffStatus.DENIED

    async def test_the_supervisor_sees_the_crews_requests(
        self, db_session, crew, outbox
    ):
        from app.api.dependencies import PaginationParams
        from app.api.v1.endpoints import scheduling as ep

        time_off = await _request(db_session, crew)
        own = await _request(db_session, crew, by=crew.captain)

        page = await ep.list_time_off_requests(
            status_filter=None,
            user_id=None,
            pagination=PaginationParams(skip=0, limit=50),
            db=db_session,
            current_user=_caller(crew.captain, ["scheduling.view"]),
        )
        flags = {i["id"]: i["reviewable_as_supervisor"] for i in page["items"]}
        assert flags == {time_off.id: True, own.id: False}

        stranger_page = await ep.list_time_off_requests(
            status_filter=None,
            user_id=uuid.UUID(crew.member.id),
            pagination=PaginationParams(skip=0, limit=50),
            db=db_session,
            current_user=_caller(crew.stranger, ["scheduling.view"]),
        )
        assert stranger_page["items"] == []
