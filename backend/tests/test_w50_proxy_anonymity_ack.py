"""W50-2 / ELEC-43: a proxy ballot on an anonymous election, acknowledged.

A proxy vote stores whom it was cast for (``proxy_delegating_user_id``,
covered by the signature) and the proxy holder sees every choice, so on an
anonymous election it is the one attributable ballot in the box. Until the
owner decided, proxy ballots were refused on anonymous elections. The
decision (2026-10-08) allows them on one condition: the delegating member
acknowledges, when the authorization is created, that the proxy holder will
see how they vote. So:

- an authorization on an anonymous election without the acknowledgement is
  refused, and one with it is stamped ``anonymity_acknowledged_at``;
- the stamped authorization votes the delegator's ballot;
- an authorization created before the rule (no stamp) is refused at the
  ballot rather than honoured;
- the delegating member is emailed the warning;
- the certified PDF's anonymity statement names the proxy exception.
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from pypdf import PdfReader
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, Vote
from app.services.election_service import (
    PROXY_ANONYMITY_ACK_REQUIRED,
    PROXY_ANONYMITY_NOT_ACKNOWLEDGED,
    ElectionService,
    position_item_id,
)
from app.utils.certified_results_pdf import render_certified_results_pdf
from tests.test_election_voting_flow import TestElectionSetup

CHIEF_ITEM_ID = position_item_id("Chief")


async def _setup(db: AsyncSession, data: dict, *, anonymous: bool) -> None:
    await db.execute(
        text("UPDATE elections SET anonymous_voting = :anon WHERE id = :id"),
        {"anon": anonymous, "id": data["election_id"]},
    )
    await db.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {
            "s": json.dumps(
                {"proxy_voting": {"enabled": True, "max_proxies_per_person": 2}}
            ),
            "id": data["org_id"],
        },
    )
    await db.flush()


async def _authorize(db: AsyncSession, data: dict, **kwargs):
    return await ElectionService(db).add_proxy_authorization(
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        delegating_user_id=uuid.UUID(data["user2_id"]),
        proxy_user_id=uuid.UUID(data["user3_id"]),
        proxy_type="single_election",
        reason="Away on deployment",
        authorized_by=uuid.UUID(data["user1_id"]),
        **kwargs,
    )


@pytest.mark.integration
class TestProxyOnAnonymousElection(TestElectionSetup):
    async def test_authorization_without_acknowledgement_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _setup(db_session, data, anonymous=True)

        record, err = await _authorize(db_session, data)

        assert record is None
        assert err == PROXY_ANONYMITY_ACK_REQUIRED

    async def test_acknowledged_proxy_votes_and_the_member_is_warned(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _setup(db_session, data, anonymous=True)
        with patch(
            "app.services.email_service.EmailService.send_email",
            new_callable=AsyncMock,
            return_value=(1, 0),
        ) as send:
            record, err = await _authorize(
                db_session, data, anonymity_acknowledged=True
            )
        assert err is None, err
        assert record["anonymity_acknowledged_at"]

        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["subject"].startswith("Proxy authorized")
        assert "your proxy holder will see how you vote" in kwargs["html_body"]

        svc = ElectionService(db_session)
        mine = await svc.get_my_proxy_authorizations(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            uuid.UUID(data["user3_id"]),
        )
        assert [p["authorization_id"] for p in mine["proxies"]] == [record["id"]]
        assert mine["unavailable_reason"] is None

        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]}],
            proxy_authorization_id=record["id"],
        )
        assert err is None, err
        assert result["votes_cast"] == 1
        vote = (
            await db_session.execute(
                select(Vote).where(Vote.election_id == data["election_id"])
            )
        ).scalar_one()
        assert vote.is_proxy_vote
        assert vote.proxy_delegating_user_id == data["user2_id"]

        listing = await svc.get_proxy_authorizations(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert listing["anonymous_voting"] is True

    async def test_an_unacknowledged_legacy_authorization_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        # Created while the election was named, then the election turned
        # anonymous: the record has no acknowledgement stamp, like one made
        # before the rule existed.
        await _setup(db_session, data, anonymous=False)
        record, err = await _authorize(db_session, data)
        assert err is None, err
        assert record["anonymity_acknowledged_at"] is None
        election = (
            await db_session.execute(
                select(Election).where(Election.id == data["election_id"])
            )
        ).scalar_one()
        election.anonymous_voting = True
        await db_session.flush()

        svc = ElectionService(db_session)
        _ballot, err = await svc.get_member_ballot(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            proxy_authorization_id=record["id"],
        )
        assert err == PROXY_ANONYMITY_NOT_ACKNOWLEDGED

        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]}],
            proxy_authorization_id=record["id"],
        )
        assert result is None
        assert err == PROXY_ANONYMITY_NOT_ACKNOWLEDGED

        mine = await svc.get_my_proxy_authorizations(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            uuid.UUID(data["user3_id"]),
        )
        assert mine["proxies"] == []
        assert mine["unavailable_reason"] == PROXY_ANONYMITY_NOT_ACKNOWLEDGED

    async def test_named_election_needs_no_acknowledgement(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _setup(db_session, data, anonymous=False)
        record, err = await _authorize(db_session, data)
        assert err is None, err
        assert record["anonymity_acknowledged_at"] is None


def _pdf_text(proxy_votes: int) -> str:
    buf = render_certified_results_pdf(
        {
            "election": {
                "title": "Officer Election",
                "closed_display": "",
                "closed_by_display": "automatic close",
                "anonymous_voting": True,
                "proxy_votes": proxy_votes,
            },
            "results": {"results_by_position": []},
            "stats": {},
            "batches": [],
            "integrity": {},
        },
        {"org_name": "W50-2 FD", "generated_at": ""},
    )
    return " ".join(page.extract_text() for page in PdfReader(buf).pages).replace(
        "\n", " "
    )


@pytest.mark.unit
class TestCertifiedAnonymityStatement:
    def test_no_proxy_votes_keeps_the_plain_statement(self):
        out = _pdf_text(0)
        assert "de-anonymization impossible." in out
        assert "proxy" not in out

    def test_proxy_votes_are_named_as_the_exception(self):
        out = _pdf_text(2)
        assert "except for 2 proxy vote(s)" in out
