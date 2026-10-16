"""W50-91: ballot emails are refused for an election with nothing to vote on.

An election with neither ballot items nor plain positions mails members a link
to an empty page. The send path now refuses it with a clear message; a
positions-only election still sends, because plain positions are served as
ballot items on the emailed ballot.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup


async def _set_contents(db: AsyncSession, election_id: str, positions, items) -> None:
    await db.execute(
        text(
            "UPDATE elections SET positions = :positions, "
            "ballot_items = :items WHERE id = :id"
        ),
        {"positions": positions, "items": items, "id": election_id},
    )
    await db.flush()


@pytest.mark.integration
class TestSendBallotRefusesEmptyElection(TestElectionSetup):
    async def test_refuses_when_there_are_no_items_or_positions(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _set_contents(db_session, data["election_id"], "[]", None)
        send = AsyncMock(return_value=[True])

        with patch("app.services.email_service.EmailService.send_batch", new=send):
            with pytest.raises(ValueError, match="nothing to vote on"):
                await ElectionService(db_session).send_ballot_emails(
                    uuid.UUID(data["election_id"]),
                    data["org_id"],
                    base_ballot_url="https://example.test/ballot",
                )
        send.assert_not_called()

    async def test_a_positions_only_election_still_sends(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _set_contents(db_session, data["election_id"], '["Chief"]', None)

        async def _accept(batch):
            return [True] * len(batch)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=_accept),
        ):
            sent, failed, _skipped, _details, _ids = await ElectionService(
                db_session
            ).send_ballot_emails(
                uuid.UUID(data["election_id"]),
                data["org_id"],
                base_ballot_url="https://example.test/ballot",
            )

        assert sent > 0
        assert failed == 0
