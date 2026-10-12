"""W50-18: a test ballot is indistinguishable from a real one.

``send-test-ballot`` mails the secretary a ballot with the same subject as
the member send, stamps the election ``email_sent`` (so the detail page
reads "Sent" and offers a Resend that warns about regenerating members'
tokens before any member has one), the receipt verifies as "counted"
while every tally excludes it, and the token lookup never says the ballot
is a test. These tests lock the marking: "[TEST]" subject, no sent stamp,
receipt reports ``counted=False``, lookup exposes ``is_test``.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import (
    BallotLookupRequest,
    VoteReceiptVerifyRequest,
    lookup_ballot_by_token,
    verify_vote_receipt,
    verify_vote_receipt_post,
)
from app.models.election import Election
from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

pytestmark = [pytest.mark.integration]

SEND_BATCH = "app.services.email_service.EmailService.send_batch"


async def _reload(db_session: AsyncSession, election_id: str) -> Election:
    result = await db_session.execute(
        select(Election).where(Election.id == election_id)
    )
    election = result.scalar_one()
    await db_session.refresh(election)
    return election


async def _send(db_session: AsyncSession, data: dict, *, is_test: bool) -> list:
    """Run send_ballot_emails to user1 with the mail service accepting all."""
    built: list = []

    async def _accept(batch):
        built.extend(batch)
        return [True] * len(batch)

    with patch(SEND_BATCH, new=AsyncMock(side_effect=_accept)):
        sent, failed, _skipped, _details, _ids = await ElectionService(
            db_session
        ).send_ballot_emails(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            recipient_user_ids=[uuid.UUID(data["user1_id"])],
            base_ballot_url="https://fd.example/ballot",
            is_test=is_test,
        )
    assert (sent, failed) == (1, 0)
    return built


async def _mint_token(db_session: AsyncSession, data: dict, *, is_test: bool):
    svc = ElectionService(db_session)
    _token, raw = await svc._generate_voting_token(
        user_id=uuid.UUID(data["user1_id"]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
        is_test=is_test,
    )
    await db_session.flush()
    return raw


class TestTestBallotMarking(TestElectionSetup):
    async def test_test_send_prefixes_subject(
        self, db_session: AsyncSession, setup_election
    ):
        built = await _send(db_session, setup_election, is_test=True)
        assert len(built) == 1
        subject = built[0].subject
        assert subject.startswith("[TEST] "), subject
        assert "Officer Election 2026" in subject

    async def test_real_send_subject_is_not_prefixed(
        self, db_session: AsyncSession, setup_election
    ):
        built = await _send(db_session, setup_election, is_test=False)
        assert not built[0].subject.startswith("[TEST]"), built[0].subject

    async def test_test_send_does_not_stamp_email_sent(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _send(db_session, data, is_test=True)

        election = await _reload(db_session, data["election_id"])
        assert election.email_sent is False, (
            "only the secretary's test ballot went out, yet the election "
            "reports member ballots as sent"
        )
        assert election.email_sent_at is None
        assert election.email_recipients in (None, [])

    async def test_real_send_still_stamps_email_sent(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _send(db_session, data, is_test=False)

        election = await _reload(db_session, data["election_id"])
        assert election.email_sent is True
        assert election.email_sent_at is not None
        assert election.email_recipients == [data["user1_id"]]

    async def test_lookup_exposes_is_test(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw_test = await _mint_token(db_session, data, is_test=True)
        raw_real = await _mint_token(db_session, data, is_test=False)

        test_lookup = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw_test), db=db_session, _rate=None
        )
        real_lookup = await lookup_ballot_by_token(
            payload=BallotLookupRequest(token=raw_real), db=db_session, _rate=None
        )
        assert test_lookup.is_test is True
        assert real_lookup.is_test is False

    async def test_receipt_for_test_vote_is_not_counted(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _mint_token(db_session, data, is_test=True)
        vote, err = await ElectionService(db_session).cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
        )
        assert err is None, err
        assert vote.is_test is True

        receipt = await verify_vote_receipt_post(
            election_id=uuid.UUID(data["election_id"]),
            payload=VoteReceiptVerifyRequest(receipt=vote.receipt_hash),
            db=db_session,
            _rate=None,
        )
        assert receipt["verified"] is True
        assert receipt["counted"] is False, (
            "a test vote's receipt claims it is counted while every tally "
            "excludes it"
        )
        assert "test" in receipt["message"].lower()
        assert "not counted" in receipt["message"].lower()

    async def test_receipt_for_real_vote_is_counted(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _mint_token(db_session, data, is_test=False)
        vote, err = await ElectionService(db_session).cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
        )
        assert err is None, err

        receipt = await verify_vote_receipt_post(
            election_id=uuid.UUID(data["election_id"]),
            payload=VoteReceiptVerifyRequest(receipt=vote.receipt_hash),
            db=db_session,
            _rate=None,
        )
        assert receipt["verified"] is True
        assert receipt["counted"] is True

    async def test_unknown_receipt_is_neither(self, db_session: AsyncSession):
        receipt = await verify_vote_receipt_post(
            election_id=uuid.uuid4(),
            payload=VoteReceiptVerifyRequest(receipt="nope"),
            db=db_session,
            _rate=None,
        )
        assert receipt["verified"] is False
        assert receipt["counted"] is False


class TestReceiptVerificationRoutes(TestElectionSetup):
    """ELEC-14: the receipt moves to a POST body; the GET stays, deprecated,
    for external callers written against the documented query-string form."""

    async def test_deprecated_get_answers_the_same_and_says_deprecated(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _mint_token(db_session, data, is_test=False)
        vote, err = await ElectionService(db_session).cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
        )
        assert err is None, err
        election_id = uuid.UUID(data["election_id"])

        response = Response()
        via_get = await verify_vote_receipt(
            election_id=election_id,
            receipt=vote.receipt_hash,
            response=response,
            db=db_session,
            _rate=None,
        )
        via_post = await verify_vote_receipt_post(
            election_id=election_id,
            payload=VoteReceiptVerifyRequest(receipt=vote.receipt_hash),
            db=db_session,
            _rate=None,
        )

        assert via_get == via_post
        assert via_post["counted"] is True
        assert response.headers["Deprecation"] == "true"
        assert "successor-version" in response.headers["Link"]

    def test_post_body_rejects_unknown_keys(self):
        with pytest.raises(ValidationError):
            VoteReceiptVerifyRequest(receipt="abc", token="leaked")

    def test_get_route_is_marked_deprecated_in_openapi(self):
        from app.api.v1.endpoints.elections import router

        methods = {
            (tuple(sorted(route.methods)), route.deprecated)
            for route in router.routes
            if getattr(route, "path", "") == "/{election_id}/verify-receipt"
        }
        assert methods == {(("GET",), True), (("POST",), None)}, methods
