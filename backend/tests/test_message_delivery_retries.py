"""MSG-12: failed and throttled department-message deliveries are retried.

The owner's decision: record a throttled send as retriable rows, retry on a
schedule — five retries, 5, 10, 20, 40 and 80 minutes apart — and after that
record the delivery as failed for good, where the delivery list shows it.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.models.notification import DepartmentMessage, DepartmentMessageDelivery
from app.models.user import Organization, User
from app.services.message_delivery_service import (
    MAX_DELIVERY_RETRIES,
    THROTTLED_REASON,
    MessageDeliveryService,
    _MessageFacts,
    _RecipientFacts,
    retry_delay,
)


@pytest.mark.unit
class TestTheSchedule:
    def test_five_retries_doubling_from_five_minutes(self):
        delays = [retry_delay(n) for n in range(1, MAX_DELIVERY_RETRIES + 2)]
        assert delays == [
            timedelta(minutes=5),
            timedelta(minutes=10),
            timedelta(minutes=20),
            timedelta(minutes=40),
            timedelta(minutes=80),
            None,
        ]

    @pytest.mark.parametrize("count", [1, 2, 3, 4, 5])
    async def test_a_failure_with_retries_left_is_retrying(self, count):
        db = MagicMock()
        db.commit = AsyncMock()
        attempt = SimpleNamespace(
            status="pending",
            error=None,
            delivered_at=None,
            attempt_count=count,
            next_attempt_at=None,
        )
        before = datetime.now(timezone.utc)

        await MessageDeliveryService(db)._finish_delivery(attempt, "relay down")

        assert attempt.status == "retrying"
        assert attempt.error == "relay down"
        wait = attempt.next_attempt_at - before
        assert timedelta(minutes=5 * 2 ** (count - 1)) <= wait
        assert wait < timedelta(minutes=5 * 2 ** (count - 1), seconds=5)

    async def test_the_sixth_failure_is_final(self):
        db = MagicMock()
        db.commit = AsyncMock()
        attempt = SimpleNamespace(
            status="pending",
            error=None,
            delivered_at=None,
            attempt_count=MAX_DELIVERY_RETRIES + 1,
            next_attempt_at=None,
        )

        await MessageDeliveryService(db)._finish_delivery(attempt, "relay down")

        assert attempt.status == "failed"
        assert attempt.next_attempt_at is None

    async def test_a_success_clears_the_retry(self):
        db = MagicMock()
        db.commit = AsyncMock()
        attempt = SimpleNamespace(
            status="pending",
            error="earlier failure",
            delivered_at=None,
            attempt_count=3,
            next_attempt_at=None,
        )

        await MessageDeliveryService(db)._finish_delivery(attempt)

        assert attempt.status == "delivered"
        assert attempt.error is None
        assert attempt.next_attempt_at is None


async def _org(db):
    org = Organization(name="Retry FD", slug=f"retry-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Sam",
        last_name="Reed",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def _message(db, org, author, **extra):
    message = DepartmentMessage(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Roof collapse drill",
        body="0700 Saturday",
        target_type="all",
        posted_by=author.id,
        **extra,
    )
    db.add(message)
    await db.flush()
    return message


async def _row(db, message, user, *, status, attempt_count=1, due_in_minutes=-1):
    row = DepartmentMessageDelivery(
        id=str(uuid.uuid4()),
        message_id=message.id,
        recipient_id=user.id,
        channel="email",
        status=status,
        idempotency_key=f"department-message:{message.id}:{user.id}:email",
        attempt_count=attempt_count,
        next_attempt_at=(
            datetime.now(timezone.utc) + timedelta(minutes=due_in_minutes)
            if status == "retrying"
            else None
        ),
        error="relay down" if status == "retrying" else None,
    )
    db.add(row)
    # Committed: _claim_delivery rolls back on the unique violation it is
    # expected to hit, which would otherwise discard the setup with it.
    await db.commit()
    return row


async def _reload(db, row_id):
    result = await db.execute(
        select(DepartmentMessageDelivery)
        .where(DepartmentMessageDelivery.id == row_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


@pytest.mark.integration
class TestThrottledSendsLeaveRetriableRows:
    async def test_every_held_back_member_gets_a_retrying_row(self, db_session):
        org = await _org(db_session)
        author = await _user(db_session, org)
        members = [await _user(db_session, org) for _ in range(2)]
        message = await _message(db_session, org, author)
        await db_session.commit()
        facts = _MessageFacts(
            id=message.id,
            organization_id=org.id,
            title=message.title,
            body=message.body,
            expires_at=None,
            priority="normal",
            requires_acknowledgment=False,
        )
        people = [_RecipientFacts(id=m.id, email=m.email) for m in members]

        with patch("app.core.security.is_rate_limited", AsyncMock(return_value=True)):
            await MessageDeliveryService(db_session)._send_email(facts, people, org)

        rows = (
            (
                await db_session.execute(
                    select(DepartmentMessageDelivery).where(
                        DepartmentMessageDelivery.message_id == message.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert {r.recipient_id for r in rows} == {m.id for m in members}
        for row in rows:
            assert row.status == "retrying"
            assert row.error == THROTTLED_REASON
            assert row.attempt_count == 1
            assert row.next_attempt_at is not None


@pytest.mark.integration
class TestADueRetryIsTheNextAttempt:
    async def test_a_due_row_is_claimed_and_counted(self, db_session):
        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        row = await _row(db_session, message, member, status="retrying")

        claimed = await MessageDeliveryService(db_session)._claim_delivery(
            message.id, member.id, "email"
        )

        assert claimed is not None
        assert claimed.id == row.id
        assert claimed.status == "pending"
        assert claimed.attempt_count == 2
        assert claimed.next_attempt_at is None

    async def test_a_row_still_waiting_is_left_alone(self, db_session):
        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        await _row(db_session, message, member, status="retrying", due_in_minutes=10)

        claimed = await MessageDeliveryService(db_session)._claim_delivery(
            message.id, member.id, "email"
        )

        assert claimed is None


@pytest.mark.integration
class TestTheRetryTask:
    async def test_only_due_rows_are_re_delivered(self, db_session, monkeypatch):
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        due_member = await _user(db_session, org)
        waiting_member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        await _row(db_session, message, due_member, status="retrying")
        await _row(
            db_session, message, waiting_member, status="retrying", due_in_minutes=30
        )

        calls = []

        async def _capture(self, msg, only_user_ids=None):
            calls.append((str(msg.id), set(only_user_ids or ())))

        monkeypatch.setattr(MessageDeliveryService, "deliver", _capture)

        result = await scheduled_tasks.run_retry_message_deliveries(db_session)

        assert (str(message.id), {str(due_member.id)}) in calls
        assert all(str(waiting_member.id) not in ids for _, ids in calls)
        assert result["messages"] >= 1

    async def test_an_expired_message_is_written_down_as_failed(
        self, db_session, monkeypatch
    ):
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(
            db_session,
            org,
            author,
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
        row = await _row(db_session, message, member, status="retrying")
        monkeypatch.setattr(MessageDeliveryService, "deliver", AsyncMock())

        await scheduled_tasks.run_retry_message_deliveries(db_session)

        stored = await _reload(db_session, row.id)
        assert stored.status == "failed"
        assert stored.next_attempt_at is None

    async def test_a_member_no_longer_targeted_is_written_down_as_failed(
        self, db_session, monkeypatch
    ):
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        row = await _row(db_session, message, member, status="retrying")
        monkeypatch.setattr(
            "app.services.messaging_service.MessagingService._targeted_users",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(MessageDeliveryService, "deliver", AsyncMock())

        await scheduled_tasks.run_retry_message_deliveries(db_session)

        stored = await _reload(db_session, row.id)
        assert stored.status == "failed"
        assert "no longer in the message audience" in stored.error

    async def test_a_throttled_member_is_emailed_on_the_retry(self, db_session):
        """End to end: held back by the cap, then sent by the retry task."""
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        await db_session.commit()
        sent_to = []

        class _Email:
            def __init__(self, organization=None):
                pass

            async def send_email(self, to_emails, results_out=None, **kwargs):
                sent_to.extend(to_emails)
                if results_out is not None:
                    results_out.extend([True] * len(to_emails))
                return (len(to_emails), 0)

        member_id, member_email = member.id, member.email

        async def _targeted(self, msg, org_id):
            # Loaded fresh each time, as the real targeting query does: the
            # commits in between expire any instance held from setup.
            result = await self.db.execute(select(User).where(User.id == member_id))
            return list(result.scalars().all())

        with patch(
            "app.services.messaging_service.MessagingService._targeted_users",
            _targeted,
        ), patch("app.services.email_service.EmailService", _Email), patch(
            "app.services.email_service.wrap_email_body", return_value="<html/>"
        ):
            with patch(
                "app.core.security.is_rate_limited", AsyncMock(return_value=True)
            ):
                await MessageDeliveryService(db_session).deliver(message)
            assert sent_to == []

            row = (
                await db_session.execute(
                    select(DepartmentMessageDelivery).where(
                        DepartmentMessageDelivery.message_id == message.id,
                        DepartmentMessageDelivery.channel == "email",
                    )
                )
            ).scalar_one()
            assert row.status == "retrying"
            # Let the five minutes pass.
            row.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db_session.commit()

            with patch(
                "app.core.security.is_rate_limited", AsyncMock(return_value=False)
            ):
                await scheduled_tasks.run_retry_message_deliveries(db_session)

        stored = await _reload(db_session, row.id)
        assert sent_to == [member_email]
        assert stored.status == "delivered"
        assert stored.attempt_count == 2
