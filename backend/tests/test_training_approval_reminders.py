"""A sign-off left waiting reminds the training officers at 7 and 14 days.

Owner decision 2026-11-23. A training session that needs an officer's
confirmation credits nobody until an officer decides (unchanged). The daily
``training_approval_reminders`` task emails the training officers once the
newest pending approval has waited 7 days and once more at 14, then stops.
The approval's ``reminder_sent_at`` is the stamp that makes a re-run send
nothing new (pitfall #36).
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from app.models.event import Event, EventType
from app.models.training import (
    ApprovalStatus,
    TrainingApproval,
    TrainingSession,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.email_service import EmailService
from app.services.scheduled_tasks import SCHEDULE, TASK_RUNNERS
from app.services.training_approval_reminders import send_approval_reminders
from tests.waiver_request_support import assign, make_position

pytestmark = pytest.mark.integration


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def sent():
    with patch.object(
        EmailService, "send_email", AsyncMock(return_value=(1, 0))
    ) as send:
        yield send


@pytest.fixture
async def dept(db_session):
    db = db_session
    org = Organization(
        id=_uid(),
        name="Sign-off Department",
        slug=f"signoff-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:10]
    officer = User(
        id=_uid(),
        organization_id=org.id,
        username=f"officer-{handle}",
        email=f"officer-{handle}@signoff.test",
        first_name="Casey",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    bystander = User(
        id=_uid(),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"member-{handle}@signoff.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add_all([officer, bystander])
    await db.flush()
    position = await make_position(
        db, org.id, "Training Officer", slug="training_officer"
    )
    await assign(db, officer.id, position)
    return org, officer


async def _session(db, org) -> str:
    start = datetime(2026, 10, 1, 18, 0, tzinfo=timezone.utc)
    event = Event(
        id=_uid(),
        organization_id=org.id,
        title="Tuesday Drill: Ladders",
        event_type=EventType.TRAINING,
        start_datetime=start,
        end_datetime=start + timedelta(hours=3),
    )
    db.add(event)
    await db.flush()
    session = TrainingSession(
        id=_uid(),
        organization_id=org.id,
        event_id=event.id,
        course_name="Ladder Operations",
        training_type=TrainingType.SKILLS_PRACTICE,
        credit_hours=3.0,
        require_completion_confirmation=True,
        is_finalized=True,
    )
    db.add(session)
    await db.flush()
    return session.id


async def _approval(
    db,
    org,
    session_id,
    created: datetime,
    *,
    status=ApprovalStatus.PENDING,
    token_live=True,
) -> str:
    session = (
        await db.execute(
            select(TrainingSession).where(TrainingSession.id == session_id)
        )
    ).scalar_one()
    approval = TrainingApproval(
        id=_uid(),
        organization_id=org.id,
        training_session_id=session_id,
        event_id=session.event_id,
        approval_token=uuid.uuid4().hex,
        token_expires_at=created + timedelta(days=30 if token_live else -1),
        status=status,
        approval_deadline=created + timedelta(days=7),
        attendee_data=[{"user_id": _uid(), "duration": 180}],
        created_at=created,
    )
    db.add(approval)
    await db.flush()
    return approval.id


async def _run(db, org, now):
    return await send_approval_reminders(db, org, now=now)


async def _stamp(db, approval_id):
    return (
        await db.execute(
            text("SELECT reminder_sent_at FROM training_approvals WHERE id = :id"),
            {"id": approval_id},
        )
    ).scalar_one()


def _created() -> datetime:
    # A fixed instant, read when the test runs (pitfall #40); every "now" in a
    # test is measured from it.
    return datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=30)


class TestTheSchedule:
    async def test_nothing_before_seven_days(self, db_session, dept, sent):
        org, _ = dept
        created = _created()
        approval = await _approval(
            db_session, org, await _session(db_session, org), created
        )

        counts = await _run(db_session, org, created + timedelta(days=6, hours=23))

        assert counts.approvals == 0
        sent.assert_not_awaited()
        assert await _stamp(db_session, approval) is None

    async def test_once_at_seven_days_once_at_fourteen_then_stop(
        self, db_session, dept, sent
    ):
        org, officer = dept
        created = _created()
        approval = await _approval(
            db_session, org, await _session(db_session, org), created
        )

        assert (await _run(db_session, org, created + timedelta(days=7))).emails == 1
        call = sent.await_args.kwargs
        assert call["to_emails"] == [officer.email]
        assert call["template_type"] == "training_approval_reminder"
        assert "Ladder Operations" in call["subject"]
        assert "waited 7 days" in call["text_body"]
        assert await _stamp(db_session, approval) is not None

        # Every later day of the first week sends nothing.
        for day in (8, 10, 13):
            counts = await _run(db_session, org, created + timedelta(days=day))
            assert counts.emails == 0

        assert (await _run(db_session, org, created + timedelta(days=14))).emails == 1
        assert "waited 14 days" in sent.await_args.kwargs["text_body"]

        for day in (15, 21, 28):
            counts = await _run(db_session, org, created + timedelta(days=day))
            assert counts.emails == 0
        assert sent.await_count == 2

    async def test_a_double_run_on_the_same_day_sends_once(
        self, db_session, dept, sent
    ):
        org, _ = dept
        created = _created()
        await _approval(db_session, org, await _session(db_session, org), created)
        now = created + timedelta(days=7, hours=2)

        first = await _run(db_session, org, now)
        second = await _run(db_session, org, now)

        assert (first.approvals, second.approvals) == (1, 0)
        assert sent.await_count == 1

    async def test_first_seen_after_fourteen_days_sends_one(
        self, db_session, dept, sent
    ):
        # The first run after an upgrade finds approvals long overdue.
        org, _ = dept
        created = _created()
        await _approval(db_session, org, await _session(db_session, org), created)

        await _run(db_session, org, created + timedelta(days=20))
        await _run(db_session, org, created + timedelta(days=21))

        assert sent.await_count == 1


class TestWhichApprovals:
    async def test_a_decided_approval_is_not_reminded(self, db_session, dept, sent):
        org, _ = dept
        created = _created()
        session_id = await _session(db_session, org)
        await _approval(
            db_session, org, session_id, created, status=ApprovalStatus.APPROVED
        )

        await _run(db_session, org, created + timedelta(days=7))

        sent.assert_not_awaited()

    async def test_only_the_newest_approval_of_a_session(self, db_session, dept, sent):
        # A re-finalize leaves the earlier approval PENDING with its link
        # killed; only the roster an officer can still approve is chased.
        org, _ = dept
        created = _created()
        session_id = await _session(db_session, org)
        older = await _approval(db_session, org, session_id, created)
        newer = await _approval(
            db_session, org, session_id, created + timedelta(hours=1)
        )

        await _run(db_session, org, created + timedelta(days=8))

        assert sent.await_count == 1
        assert await _stamp(db_session, older) is None
        assert await _stamp(db_session, newer) is not None

    async def test_a_dead_link_is_not_reminded(self, db_session, dept, sent):
        org, _ = dept
        created = _created()
        await _approval(
            db_session,
            org,
            await _session(db_session, org),
            created,
            token_live=False,
        )

        await _run(db_session, org, created + timedelta(days=7))

        sent.assert_not_awaited()

    async def test_another_department_s_approval_is_untouched(
        self, db_session, dept, sent
    ):
        org, _ = dept
        created = _created()
        other_org = Organization(
            id=_uid(), name="Other", slug=f"other-{uuid.uuid4().hex[:8]}"
        )
        db_session.add(other_org)
        await db_session.flush()
        foreign = await _approval(
            db_session, other_org, await _session(db_session, other_org), created
        )

        await _run(db_session, org, created + timedelta(days=7))

        sent.assert_not_awaited()
        assert await _stamp(db_session, foreign) is None


class TestTheTask:
    def test_it_is_registered_to_run_daily(self):
        assert "training_approval_reminders" in TASK_RUNNERS
        assert SCHEDULE["training_approval_reminders"]["frequency"] == "daily"
