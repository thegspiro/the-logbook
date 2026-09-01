"""An interrupted worker must not suppress a department message for good.

`MessageDeliveryService._claim_delivery` writes one `pending` row per
recipient and commits it *before* the send. That is what makes a delivery
auditable and stops two workers emailing the same member twice, and it costs a
window: a worker that dies between claiming and recording the result leaves
rows nothing revisits, while the unique idempotency key makes every later
attempt skip those members. Nobody is emailed and the audit row says an
attempt is still in flight — on the channel of record (CLAUDE.md pitfall #18).

Sending the batch through one connection widened that window from a single
member to a whole department, which is what makes recovery necessary rather
than merely tidy. Two halves: an abandoned claim can be taken over, and
something goes looking for them.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.notification import (
    DepartmentMessage,
    DepartmentMessageDelivery,
)
from app.models.user import Organization, User
from app.services.message_delivery_service import MessageDeliveryService

pytestmark = [pytest.mark.integration]


async def _org(db):
    org = Organization(name="Claim FD", slug=f"claim-{uuid.uuid4().hex[:8]}")
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


async def _message(db, org, user):
    message = DepartmentMessage(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Roof collapse drill",
        body="0700 Saturday",
        target_type="all",
        posted_by=user.id,
    )
    db.add(message)
    await db.flush()
    return message


async def _claim_row(db, message, user, status="pending", age_minutes=90):
    row = DepartmentMessageDelivery(
        id=str(uuid.uuid4()),
        message_id=message.id,
        recipient_id=user.id,
        channel="email",
        status=status,
        idempotency_key=f"department-message:{message.id}:{user.id}:email",
        attempted_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes),
    )
    db.add(row)
    # Committed, not just flushed: `_claim_delivery` rolls back on the unique
    # violation it is *expected* to hit here, and under the savepoint-based
    # session fixture that rollback would otherwise discard this row along
    # with the rest of the setup — leaving the reclaim nothing to find and
    # every assertion below passing for the wrong reason.
    await db.commit()
    return row


class TestAnAbandonedClaimCanBeTakenOver:
    async def test_a_stale_pending_claim_is_handed_back(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        message = await _message(db_session, org, user)
        stranded = await _claim_row(db_session, message, user)

        claimed = await MessageDeliveryService(db_session)._claim_delivery(
            message.id, user.id, "email"
        )

        assert claimed is not None, (
            "an abandoned claim that nothing can take over suppresses this "
            "member's copy of the message permanently"
        )
        assert claimed.id == stranded.id
        # Re-stamped, so a second worker scanning the same row finds it fresh
        # and leaves it alone rather than sending a third copy.
        assert claimed.attempted_at > datetime.now(timezone.utc) - timedelta(minutes=1)

    async def test_a_fresh_pending_claim_is_left_alone(self, db_session):
        """Another worker is mid-send; taking its claim would double-send."""
        org = await _org(db_session)
        user = await _user(db_session, org)
        message = await _message(db_session, org, user)
        await _claim_row(db_session, message, user, age_minutes=1)

        claimed = await MessageDeliveryService(db_session)._claim_delivery(
            message.id, user.id, "email"
        )

        assert claimed is None

    @pytest.mark.parametrize("status", ["delivered", "failed"])
    async def test_a_resolved_claim_is_never_reclaimed(self, db_session, status):
        """Delivered is done. Failed carries a recorded outcome, and a retry
        that nobody asked for would overwrite it."""
        org = await _org(db_session)
        user = await _user(db_session, org)
        message = await _message(db_session, org, user)
        await _claim_row(db_session, message, user, status=status)

        claimed = await MessageDeliveryService(db_session)._claim_delivery(
            message.id, user.id, "email"
        )

        assert claimed is None


class TestTheSweepFindsThem:
    async def test_a_stranded_claim_is_re_delivered_to_that_member_only(
        self, db_session, monkeypatch
    ):
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        stranded_member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        await _claim_row(db_session, message, stranded_member)

        # A second member whose claim resolved: the sweep must not re-notify
        # somebody who already received it.
        delivered_member = await _user(db_session, org)
        await _claim_row(db_session, message, delivered_member, status="delivered")

        calls = []

        async def _capture(self, msg, only_user_ids=None):
            calls.append((str(msg.id), set(only_user_ids or ())))

        # The task imports the class from its own module and instantiates it,
        # so patching the method on the class is what the sweep will call.
        monkeypatch.setattr(MessageDeliveryService, "deliver", _capture)

        result = await scheduled_tasks.run_recover_stranded_message_deliveries(
            db_session
        )

        assert result["messages"] == 1
        assert calls == [(str(message.id), {str(stranded_member.id)})]

    async def test_a_deactivated_message_is_not_re_delivered(
        self, db_session, monkeypatch
    ):
        """Recovering a claim is no reason to mail out a notice leadership
        took down. The normal entry point requires an active message; the
        sweep has to apply the same rule."""
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        message.is_active = False
        await _claim_row(db_session, message, member)

        calls = []

        async def _capture(self, msg, only_user_ids=None):
            calls.append(str(msg.id))

        monkeypatch.setattr(MessageDeliveryService, "deliver", _capture)

        result = await scheduled_tasks.run_recover_stranded_message_deliveries(
            db_session
        )

        assert result["messages"] == 0
        assert calls == []

    async def test_a_fresh_claim_is_not_swept(self, db_session, monkeypatch):
        from app.services import scheduled_tasks

        org = await _org(db_session)
        author = await _user(db_session, org)
        member = await _user(db_session, org)
        message = await _message(db_session, org, author)
        await _claim_row(db_session, message, member, age_minutes=2)

        calls = []

        async def _capture(self, msg, only_user_ids=None):
            calls.append(str(msg.id))

        monkeypatch.setattr(MessageDeliveryService, "deliver", _capture)

        result = await scheduled_tasks.run_recover_stranded_message_deliveries(
            db_session
        )

        assert result["messages"] == 0
        assert calls == []
