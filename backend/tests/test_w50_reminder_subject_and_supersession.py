"""W50-27: a non-voter reminder read as a second ballot notice.

The reminder went out under the template's "Ballot Available" subject (the
``subject`` passed to ``send_ballot_emails`` was never read), re-stamped
``email_sent_at`` so the detail page moved its "Sent" mark beside *Resend
Ballot Emails*, printed the close time in a second date format under the
template's own, and the link it replaced answered "Voting token has
expired" while voting was still open.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, VotingToken
from app.services.election_service import (
    REOPENED_TOKEN_MESSAGE,
    SUPERSEDED_TOKEN_MESSAGE,
    ElectionService,
)
from app.utils.org_timezone import ZONED_DATE_TIME_FORMAT, format_in_org_timezone
from tests.test_election_voting_flow import TestElectionSetup

pytestmark = [pytest.mark.integration]

SEND_BATCH = "app.services.email_service.EmailService.send_batch"
BALLOT_URL = "https://fd.example/ballot"


async def _reload(db_session: AsyncSession, election_id: str) -> Election:
    result = await db_session.execute(
        select(Election).where(Election.id == election_id)
    )
    election = result.scalar_one()
    await db_session.refresh(election)
    return election


def _accepting(built: list) -> AsyncMock:
    async def _accept(batch):
        built.extend(batch)
        return [True] * len(batch)

    return AsyncMock(side_effect=_accept)


async def _send_ballots(db_session: AsyncSession, data: dict) -> list:
    built: list = []
    with patch(SEND_BATCH, new=_accepting(built)):
        sent, failed, _s, _d, _ids = await ElectionService(
            db_session
        ).send_ballot_emails(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            base_ballot_url=BALLOT_URL,
        )
    assert (sent, failed) == (3, 0)
    return built


async def _remind(db_session: AsyncSession, data: dict) -> list:
    built: list = []
    with patch(SEND_BATCH, new=_accepting(built)):
        reminded, failed, _s, _d = await ElectionService(db_session).remind_non_voters(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            base_ballot_url=BALLOT_URL,
        )
    assert (reminded, failed) == (3, 0)
    return built


def _raw_token(message) -> str:
    match = re.search(r"#token=([A-Za-z0-9_\-]+)", message.text_body or "")
    assert match, "ballot email carries no token link"
    return match.group(1)


class TestReminderMail(TestElectionSetup):
    async def test_reminder_subject_names_it_a_reminder(
        self, db_session: AsyncSession, setup_election
    ):
        built = await _remind(db_session, setup_election)
        assert len(built) == 3
        for message in built:
            assert (
                message.subject == "Reminder: vote in Officer Election 2026"
            ), message.subject

    async def test_resend_dialog_subject_reaches_the_mail(
        self, db_session: AsyncSession, setup_election
    ):
        """The subject typed into the resend dialog is what members get."""
        data = setup_election
        built: list = []
        with patch(SEND_BATCH, new=_accepting(built)):
            await ElectionService(db_session).send_ballot_emails(
                election_id=uuid.UUID(data["election_id"]),
                organization_id=uuid.UUID(data["org_id"]),
                subject="Corrected ballot link",
                base_ballot_url=BALLOT_URL,
            )
        assert {m.subject for m in built} == {"Corrected ballot link"}

    async def test_reminder_does_not_restamp_email_sent_at(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _send_ballots(db_session, data)
        first_send = (datetime.now(timezone.utc) - timedelta(hours=6)).replace(
            microsecond=0
        )
        await db_session.execute(
            text("UPDATE elections SET email_sent_at = :at WHERE id = :id"),
            {"at": first_send, "id": data["election_id"]},
        )

        await _remind(db_session, data)

        election = await _reload(db_session, data["election_id"])
        assert election.email_sent is True
        assert (
            election.email_sent_at.replace(tzinfo=timezone.utc) == first_send
        ), "a reminder moved the 'ballots sent' stamp"
        assert election.reminder_sent_at is not None
        assert election.reminder_sent_at.replace(tzinfo=timezone.utc) > first_send

    async def test_reminder_close_time_uses_the_template_date_format(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        built = await _remind(db_session, data)
        election = await _reload(db_session, data["election_id"])
        org = (
            await db_session.execute(
                text("SELECT timezone FROM organizations WHERE id = :id"),
                {"id": data["org_id"]},
            )
        ).one()
        # The template's own facts print the close with its zone (W50-68), so
        # the prose line quotes it the same way.
        expected = format_in_org_timezone(
            election.end_date.replace(tzinfo=timezone.utc),
            type("Org", (), {"timezone": org.timezone})(),
            ZONED_DATE_TIME_FORMAT,
        )
        text_body = built[0].text_body or ""
        assert f"Voting closes at {expected}." in text_body, text_body
        assert f"Voting Closes: {expected}" in text_body, text_body
        assert not re.search(
            r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", text_body
        ), "the reminder line prints the close in a second date format"


class TestSupersededToken(TestElectionSetup):
    async def test_replaced_link_says_so_instead_of_expired(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        first = await _send_ballots(db_session, data)
        old_raw = _raw_token(first[0])
        fresh = await _remind(db_session, data)
        new_raw = _raw_token(next(m for m in fresh if m.to_email == first[0].to_email))

        svc = ElectionService(db_session)
        election, token, error = await svc.get_ballot_by_token(old_raw)
        assert (election, token) == (None, None)
        assert error == SUPERSEDED_TOKEN_MESSAGE
        assert error != "Voting token has expired"

        election, token, error = await svc.get_ballot_by_token(new_raw)
        assert error is None
        assert election is not None
        assert token is not None

    async def test_superseded_tokens_are_stamped(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _send_ballots(db_session, data)
        await _remind(db_session, data)
        tokens = (
            (
                await db_session.execute(
                    select(VotingToken).where(
                        VotingToken.election_id == data["election_id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(tokens) == 6
        stamped = [t for t in tokens if t.superseded_at is not None]
        assert len(stamped) == 3
        now = datetime.now(timezone.utc)
        for t in stamped:
            assert t.expires_at.replace(tzinfo=timezone.utc) <= now
        live = [t for t in tokens if t.superseded_at is None]
        assert all(t.expires_at.replace(tzinfo=timezone.utc) > now for t in live)

    async def test_plain_expiry_still_reads_expired(
        self, db_session: AsyncSession, setup_election
    ):
        """A token that merely ran out (no reminder) keeps the expiry wording."""
        data = setup_election
        first = await _send_ballots(db_session, data)
        raw = _raw_token(first[0])
        await db_session.execute(
            text(
                "UPDATE voting_tokens SET expires_at = :at " "WHERE election_id = :eid"
            ),
            {
                "at": datetime.now(timezone.utc) - timedelta(minutes=5),
                "eid": data["election_id"],
            },
        )
        _e, _t, error = await ElectionService(db_session).get_ballot_by_token(raw)
        assert error == "Voting token has expired"


class TestReopenedToken(TestElectionSetup):
    """A zero-vote rollback of an anonymous election retires every issued link
    (the salt they were keyed to is replaced). The re-drive found those links
    read "Voting token has expired" two days before the end (REDRIVE-A-5)."""

    async def _close_and_reopen(self, db_session: AsyncSession, data: dict) -> None:
        svc = ElectionService(db_session)
        _closed, err = await svc.close_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            closed_by=uuid.UUID(data["user1_id"]),
        )
        assert err is None, err
        reopened, _n, err = await svc.rollback_election(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            performed_by=uuid.UUID(data["user1_id"]),
            reason="re-drive",
        )
        assert err is None, err
        assert reopened is not None and reopened.status.value == "open"

    async def test_link_retired_by_a_rollback_says_reopened_not_expired(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        first = await _send_ballots(db_session, data)
        old_raw = _raw_token(first[0])
        await self._close_and_reopen(db_session, data)

        election, token, error = await svc_lookup(db_session, old_raw)
        assert (election, token) == (None, None)
        assert error == REOPENED_TOKEN_MESSAGE

    async def test_after_the_re_send_the_old_link_still_says_reopened(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        first = await _send_ballots(db_session, data)
        old_raw = _raw_token(first[0])
        await self._close_and_reopen(db_session, data)
        fresh = await _send_ballots(db_session, data)
        new_raw = _raw_token(next(m for m in fresh if m.to_email == first[0].to_email))

        _e, _t, error = await svc_lookup(db_session, old_raw)
        # The re-send keys new tokens to the new salt, so the old link has no
        # newer sibling by hash: it was reopened, not reminded.
        assert error == REOPENED_TOKEN_MESSAGE
        assert error != "Voting token has expired"

        election, token, error = await svc_lookup(db_session, new_raw)
        assert error is None
        assert election is not None and token is not None


async def svc_lookup(db_session: AsyncSession, raw: str):
    return await ElectionService(db_session).get_ballot_by_token(raw)
