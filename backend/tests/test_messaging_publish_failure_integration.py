"""A scheduled message that fails to publish is tried again, not lost.

MSG2-11: the publish task cleared ``scheduled_at`` for the whole batch and
committed it, then wrote each message's recipient rows. A failure writing them
(an exception, a transient database error, a worker restart mid-batch) left the
message active with no schedule and no recipients. The inbox, unread count and
acknowledgment report all read recipient rows, so nobody saw it; no email went
out; and the next run did not select it, because nothing was scheduled any
more. The claim and the recipient rows are now written together, per message,
so a failure leaves the message scheduled for the next run.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

from app.models.notification import DepartmentMessage, DepartmentMessageRecipient
from app.models.user import Organization, User, UserStatus
from app.services.messaging_service import MessagingService

pytestmark = [pytest.mark.integration]


async def _org(db):
    org = Organization(name="Publish FD", slug=f"pub-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="A",
        last_name="B",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


async def _recipients(db, message_id):
    return (
        await db.execute(
            select(func.count(DepartmentMessageRecipient.id)).where(
                DepartmentMessageRecipient.message_id == message_id,
                DepartmentMessageRecipient.revoked_at.is_(None),
            )
        )
    ).scalar()


async def test_a_failed_publish_is_retried_on_the_next_run(db_session, monkeypatch):
    from app.services import scheduled_tasks
    from app.services.message_delivery_service import MessageDeliveryService

    org = await _org(db_session)
    author = await _user(db_session, org)
    await _user(db_session, org)
    message = DepartmentMessage(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Scheduled",
        body="b",
        target_type="all",
        posted_by=author.id,
        scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    db_session.add(message)
    await db_session.commit()
    message_id = message.id

    async def fails(self, msg):
        raise RuntimeError("transient DB error")

    deliver = AsyncMock()
    monkeypatch.setattr(MessagingService, "materialize_recipients", fails)
    monkeypatch.setattr(MessageDeliveryService, "deliver", deliver)
    first = await scheduled_tasks.run_publish_scheduled_messages(db_session)
    monkeypatch.undo()
    monkeypatch.setattr(MessageDeliveryService, "deliver", deliver)

    second = await scheduled_tasks.run_publish_scheduled_messages(db_session)

    assert first["failed"] == 1
    assert second["published"] == 1
    stored = (
        await db_session.execute(
            select(DepartmentMessage)
            .where(DepartmentMessage.id == message_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert stored.scheduled_at is None
    assert await _recipients(db_session, message_id) > 0
    assert deliver.await_count == 1
