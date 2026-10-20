"""W50-72: a scheduled (automatic) open sends the ballots.

The lifecycle task's auto-open changed the status only, so the department's
first ballot mail was the pre-close reminder — or nothing, with reminders
off. The owner decided (2026-10-08): auto-open sends ballots as the
election's creator using the department's configured app URL, and a failed
send leaves the election open and alerts the managers to resend.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.audit import AuditLog
from app.models.election import Election, ElectionStatus
from app.services.election_service import ElectionService
from tests.queued_send_runner import capture_queued_sends
from tests.test_election_voting_flow import TestElectionSetup


async def _due_draft(db: AsyncSession, data: dict) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            "UPDATE elections SET status = 'draft', auto_open = 1, "
            "start_date = :start, end_date = :end WHERE id = :id"
        ),
        {
            "start": now - timedelta(minutes=5),
            "end": now + timedelta(days=1),
            "id": data["election_id"],
        },
    )
    await db.flush()


async def _election(db: AsyncSession, data: dict) -> Election:
    return (
        await db.execute(
            select(Election)
            .where(Election.id == data["election_id"])
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _audit_rows(db: AsyncSession, event_type: str):
    return (
        (await db.execute(select(AuditLog).where(AuditLog.event_type == event_type)))
        .scalars()
        .all()
    )


@pytest.mark.integration
class TestAutoOpenSendsBallots(TestElectionSetup):
    async def test_auto_open_mails_the_ballots_as_the_creator(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _due_draft(db_session, data)
        built: list = []

        async def _accept(batch):
            built.extend(batch)
            return [True] * len(batch)

        async with capture_queued_sends(db_session) as sends:
            with patch(
                "app.services.email_service.EmailService.send_batch",
                new=AsyncMock(side_effect=_accept),
            ):
                actions = await ElectionService(db_session).process_election_lifecycle(
                    uuid.UUID(data["org_id"])
                )
                # The open queues the send; nothing is mailed inside the tick.
                assert built == []
                assert await sends.drain() == 1

        assert actions >= 1
        election = await _election(db_session, data)
        assert election.status == ElectionStatus.OPEN
        assert election.email_sent is True
        assert len(built) == 3
        base = f"{settings.FRONTEND_URL.rstrip('/')}/ballot#token="
        creator_email = "voter1@test.com"
        for message in built:
            assert base in message.html_body
            assert message.reply_to == creator_email
        rows = [
            r
            for r in await _audit_rows(db_session, "ballots_auto_sent")
            if (r.event_data or {}).get("election_id") == data["election_id"]
        ]
        assert len(rows) == 1
        assert rows[0].user_id == data["user1_id"]

    async def test_a_failed_send_keeps_it_open_and_alerts_managers(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _due_draft(db_session, data)

        async def _reject(batch):
            return [False] * len(batch)

        def _is_manager(user, permission):
            return permission == "elections.manage" and str(user.id) == data["user1_id"]

        with (
            patch(
                "app.services.email_service.EmailService.send_batch",
                new=AsyncMock(side_effect=_reject),
            ),
            patch(
                "app.services.email_service.EmailService.send_email",
                new_callable=AsyncMock,
                return_value=(1, 0),
            ) as alert,
            patch("app.api.dependencies.user_has_permission", side_effect=_is_manager),
        ):
            async with capture_queued_sends(db_session) as sends:
                await ElectionService(db_session).process_election_lifecycle(
                    uuid.UUID(data["org_id"])
                )
                await sends.drain()

        election = await _election(db_session, data)
        assert election.status == ElectionStatus.OPEN
        assert election.email_sent is False
        alert.assert_awaited_once()
        kwargs = alert.await_args.kwargs
        assert kwargs["to_emails"] == ["voter1@test.com"]
        assert "Send Ballot Emails" in kwargs["html_body"]
        assert "failed to send" in kwargs["html_body"]
        rows = [
            r
            for r in await _audit_rows(db_session, "ballots_auto_send_failed")
            if (r.event_data or {}).get("election_id") == data["election_id"]
        ]
        assert len(rows) == 1

    async def test_a_send_that_raises_still_leaves_it_open(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _due_draft(db_session, data)

        with (
            patch.object(
                ElectionService,
                "send_ballot_emails",
                new=AsyncMock(side_effect=RuntimeError("smtp down")),
            ),
            patch(
                "app.services.email_service.EmailService.send_email",
                new_callable=AsyncMock,
                return_value=(1, 0),
            ) as alert,
            patch("app.api.dependencies.user_has_permission", return_value=True),
        ):
            async with capture_queued_sends(db_session) as sends:
                await ElectionService(db_session).process_election_lifecycle(
                    uuid.UUID(data["org_id"])
                )
                await sends.drain()

        election = await _election(db_session, data)
        assert election.status == ElectionStatus.OPEN
        alert.assert_awaited_once()
        assert "could not be sent" in alert.await_args.kwargs["html_body"]
