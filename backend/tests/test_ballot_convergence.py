"""One ballot model for both ballots, and the proxy ballot (2026-10-05).

The owner decided to converge the in-app ballot onto ballot items and to
give the emailed (token) ballot positional support, and to finish proxy
voting as a mode of that ballot. Before:

- the in-app Cast Vote tab rendered ``election.positions`` only, so a
  motion or membership item was invisible to it;
- the emailed ballot rendered ballot items only, so a member eligible only
  for a plain position opened an empty ballot, and a position-only election
  could not be emailed at all;
- proxies could be configured but no ballot let a proxy vote.

A plain position is now served to both ballots as a ballot item
(``position_ballot_items``), stored, deduplicated and tallied under the
position name exactly as before, and the in-app ballot is submitted in the
emailed ballot's shape through ``submit_member_ballot``. Proxy ballots run
on named elections only until ELEC-43 is decided.
"""

import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import BallotLookupRequest, lookup_ballot_by_token
from app.models.election import Vote
from app.services.election_service import (
    ElectionService,
    position_ballot_items,
    position_item_id,
)
from tests.test_election_voting_flow import TestElectionSetup

MOTION = {
    "id": "budget",
    "type": "general_vote",
    "title": "Approve the 2027 budget",
    "vote_type": "approval",
    "eligible_voter_types": ["all"],
}
CHIEF_ITEM_ID = position_item_id("Chief")


@pytest.mark.unit
class TestPositionItems:
    def test_a_plain_position_becomes_an_item_with_a_valid_stable_id(self):
        election = SimpleNamespace(
            positions=["Chief", "Board of Directors"], ballot_items=None
        )
        items = position_ballot_items(election)
        assert [i["title"] for i in items] == ["Chief", "Board of Directors"]
        for item in items:
            assert re.fullmatch(r"[A-Za-z0-9_-]{1,100}", item["id"]), item["id"]
            assert item["position"] == item["title"]
            assert item["vote_type"] == "candidate_selection"
        assert items[0]["id"] == position_item_id("Chief")

    def test_a_position_an_item_claims_is_not_repeated(self):
        election = SimpleNamespace(
            positions=["Chief", "Captain"],
            ballot_items=[{"id": "c", "title": "Chief race", "position": "Chief"}],
        )
        assert [i["title"] for i in position_ballot_items(election)] == ["Captain"]


async def _mixed(db: AsyncSession, data: dict, *, anonymous: bool = True) -> None:
    await db.execute(
        text(
            "UPDATE elections SET ballot_items = :items, anonymous_voting = :anon "
            "WHERE id = :id"
        ),
        {"items": json.dumps([MOTION]), "anon": anonymous, "id": data["election_id"]},
    )
    await db.flush()


async def _token(db: AsyncSession, data: dict, user_key: str, **snapshots) -> str:
    _row, raw = await ElectionService(db)._generate_voting_token(
        user_id=uuid.UUID(data[user_key]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
        **snapshots,
    )
    await db.flush()
    return raw


async def _votes(db: AsyncSession, election_id: str):
    result = await db.execute(
        select(Vote)
        .where(Vote.election_id == election_id)
        .where(Vote.deleted_at.is_(None))
    )
    return list(result.scalars().all())


@pytest.mark.integration
class TestTokenBallotCarriesPositions(TestElectionSetup):
    async def test_lookup_serves_the_plain_position_as_an_item(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data)
        raw = await _token(
            db_session,
            data,
            "user3_id",
            eligible_item_ids=["budget"],
            eligible_positions=["Chief"],
        )

        response = await lookup_ballot_by_token(
            BallotLookupRequest(token=raw), db=db_session, _rate=None
        )

        ids = [item.id for item in response.election.ballot_items]
        assert ids == ["budget", CHIEF_ITEM_ID]
        assert {c.name for c in response.candidates} >= {"Alice Anderson", "Bob Baker"}

    async def test_a_position_the_token_may_not_vote_is_not_served(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data)
        raw = await _token(
            db_session,
            data,
            "user3_id",
            eligible_item_ids=["budget"],
            eligible_positions=[],
        )

        response = await lookup_ballot_by_token(
            BallotLookupRequest(token=raw), db=db_session, _rate=None
        )

        assert [item.id for item in response.election.ballot_items] == ["budget"]

    async def test_a_position_only_voter_submits_the_position(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _token(db_session, data, "user3_id", eligible_positions=["Chief"])

        result, err = await ElectionService(db_session).submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_b_id"]}],
        )

        assert err is None, err
        assert result["votes_cast"] == 1
        (vote,) = await _votes(db_session, data["election_id"])
        assert vote.position == "Chief"
        assert vote.candidate_id == data["candidate_b_id"]

    async def test_the_positions_snapshot_still_governs(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _token(db_session, data, "user3_id", eligible_positions=[])

        result, err = await ElectionService(db_session).submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_b_id"]}],
        )

        assert result is None
        assert "not eligible to vote for Chief" in err

    async def test_approve_is_not_a_choice_for_a_position(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _token(db_session, data, "user3_id", eligible_positions=["Chief"])

        _result, err = await ElectionService(db_session).submit_ballot_with_token(
            token=raw, votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": "approve"}]
        )

        assert "not choices for: Chief" in err

    async def test_an_in_app_vote_blocks_the_same_race_on_the_link(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        svc = ElectionService(db_session)
        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]}],
        )
        assert err is None, err
        raw = await _token(db_session, data, "user3_id", eligible_positions=["Chief"])

        again, err = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_b_id"]}],
        )

        assert again is None
        assert "already voted" in err
        assert len(await _votes(db_session, data["election_id"])) == 1


@pytest.mark.integration
class TestInAppBallot(TestElectionSetup):
    async def test_the_ballot_lists_items_and_positions_with_standing(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data)
        svc = ElectionService(db_session)

        ballot, err = await svc.get_member_ballot(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )

        assert err is None, err
        assert [i["id"] for i in ballot["ballot_items"]] == ["budget", CHIEF_ITEM_ID]
        assert all(s["eligible"] and not s["voted"] for s in ballot["items"])

    async def test_a_whole_ballot_is_cast_in_one_submission(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data)
        svc = ElectionService(db_session)

        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[
                {"ballot_item_id": "budget", "choice": "approve"},
                {"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_b_id"]},
            ],
        )

        assert err is None, err
        assert result["votes_cast"] == 2
        assert len(result["receipt_hashes"]) == 2
        votes = await _votes(db_session, data["election_id"])
        assert sorted(v.position for v in votes) == ["Chief", "budget"]
        assert all(
            v.voter_id is None for v in votes
        ), "anonymous ballot named its voter"

        ballot, _err = await svc.get_member_ballot(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )
        assert all(s["voted"] for s in ballot["items"])

    async def test_a_refused_selection_records_nothing(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data)
        svc = ElectionService(db_session)
        _r, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]}],
        )
        assert err is None, err

        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[
                {"ballot_item_id": "budget", "choice": "deny"},
                {"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_b_id"]},
            ],
        )

        assert result is None
        assert "no votes were recorded" in err
        assert len(await _votes(db_session, data["election_id"])) == 1

    async def test_items_left_on_abstain_stay_open(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data)
        svc = ElectionService(db_session)
        args = dict(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
        )
        first, err = await svc.submit_member_ballot(
            **args,
            votes=[
                {"ballot_item_id": "budget", "choice": "approve"},
                {"ballot_item_id": CHIEF_ITEM_ID, "choice": "abstain"},
            ],
        )
        assert err is None, err
        assert first["abstentions"] == 1

        second, err = await svc.submit_member_ballot(
            **args,
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]}],
        )
        assert err is None, err
        assert second["votes_cast"] == 1

    async def test_an_all_abstain_submission_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        result, err = await ElectionService(db_session).submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": "abstain"}],
        )
        assert result is None
        assert "at least one item" in err

    async def test_an_out_of_date_item_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        _result, err = await ElectionService(db_session).submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": "gone", "choice": "approve"}],
        )
        assert "out of date" in err


async def _enable_proxy(db: AsyncSession, data: dict) -> str:
    await db.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {
            "s": json.dumps(
                {"proxy_voting": {"enabled": True, "max_proxies_per_person": 2}}
            ),
            "id": data["org_id"],
        },
    )
    record, err = await ElectionService(db).add_proxy_authorization(
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        delegating_user_id=uuid.UUID(data["user2_id"]),
        proxy_user_id=uuid.UUID(data["user3_id"]),
        proxy_type="single_election",
        reason="Away on deployment",
        authorized_by=uuid.UUID(data["user1_id"]),
    )
    assert err is None, err
    return record["id"]


@pytest.mark.integration
class TestProxyBallot(TestElectionSetup):
    async def test_the_holder_sees_and_casts_the_delegators_ballot(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data, anonymous=False)
        auth_id = await _enable_proxy(db_session, data)
        svc = ElectionService(db_session)

        mine = await svc.get_my_proxy_authorizations(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            uuid.UUID(data["user3_id"]),
        )
        assert [p["authorization_id"] for p in mine["proxies"]] == [auth_id]

        ballot, err = await svc.get_member_ballot(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            proxy_authorization_id=auth_id,
        )
        assert err is None, err
        assert ballot["proxy"]["delegating_user_id"] == data["user2_id"]

        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[
                {"ballot_item_id": "budget", "choice": "approve"},
                {"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]},
            ],
            proxy_authorization_id=auth_id,
        )
        assert err is None, err
        assert result["votes_cast"] == 2
        votes = await _votes(db_session, data["election_id"])
        assert all(v.is_proxy_vote for v in votes)
        assert {v.proxy_delegating_user_id for v in votes} == {data["user2_id"]}
        assert {v.proxy_voter_id for v in votes} == {data["user3_id"]}

        # The delegator's own ballot now reads as voted; the holder's does not.
        delegator, _e = await svc.get_member_ballot(
            uuid.UUID(data["user2_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )
        holder, _e = await svc.get_member_ballot(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
        )
        assert all(s["voted"] for s in delegator["items"])
        assert not any(s["voted"] for s in holder["items"])

    async def test_a_proxy_ballot_on_an_anonymous_election_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data, anonymous=True)
        auth_id = await _enable_proxy(db_session, data)
        svc = ElectionService(db_session)

        _ballot, err = await svc.get_member_ballot(
            uuid.UUID(data["user3_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            proxy_authorization_id=auth_id,
        )
        assert "named (non-anonymous) elections only" in err

        result, err = await svc.submit_member_ballot(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            votes=[{"ballot_item_id": CHIEF_ITEM_ID, "choice": data["candidate_a_id"]}],
            proxy_authorization_id=auth_id,
        )
        assert result is None
        assert "named (non-anonymous) elections only" in err
        assert await _votes(db_session, data["election_id"]) == []

        mine = await svc.get_my_proxy_authorizations(
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            uuid.UUID(data["user3_id"]),
        )
        assert mine["proxies"] == []
        assert "named (non-anonymous)" in mine["unavailable_reason"]

    async def test_only_the_designated_holder_may_use_it(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _mixed(db_session, data, anonymous=False)
        auth_id = await _enable_proxy(db_session, data)

        _ballot, err = await ElectionService(db_session).get_member_ballot(
            uuid.UUID(data["user1_id"]),
            uuid.UUID(data["election_id"]),
            uuid.UUID(data["org_id"]),
            proxy_authorization_id=auth_id,
        )
        assert err == "You are not the designated proxy for this authorization"
