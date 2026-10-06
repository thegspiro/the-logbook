"""
W50 S12 — proxy-vote parity with ``cast_vote``, and the unread
``max_proxies_per_person`` setting.

``cast_vote`` validates ``vote_rank`` against the voting method and applies
method-aware duplicate rules (approval: one vote per candidate; ranked
choice: one per rank). ``cast_proxy_vote`` must apply the same rules,
through the shared ``_validate_vote_limits`` helper, so a proxy's ballot is
the same ballot as the member's own — it used to apply a blanket "already
voted for this position" rule and never validated ``vote_rank``.

``proxy_voting.max_proxies_per_person`` is stored and shown in settings, so
``add_proxy_authorization`` must read it: an active authorization count per
*proxy* member at or above the cap refuses the next delegation. It used to
block only a second authorization for the same *delegating* member.

Reuses the raw-SQL ``setup_election`` fixture (OPEN, two candidates for
"Chief") from ``test_election_voting_flow``.
"""

import json
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import ElectionSettingsUpdate
from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

# Marked per class rather than at module level: the schema-bounds tests need
# no database and must stay in the unit job (Pitfall 30b).


async def _enable_proxy_voting(
    db_session: AsyncSession, org_id: str, max_per_person: int = 1
) -> None:
    await db_session.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {
            "s": json.dumps(
                {
                    "proxy_voting": {
                        "enabled": True,
                        "max_proxies_per_person": max_per_person,
                    }
                }
            ),
            "id": org_id,
        },
    )


async def _set_method(db_session: AsyncSession, election_id: str, method: str):
    await db_session.execute(
        text("UPDATE elections SET voting_method = :m WHERE id = :id"),
        {"m": method, "id": election_id},
    )
    await db_session.flush()


async def _authorize(svc: ElectionService, data, delegating: str, proxy: str):
    # A proxy ballot is cast on named elections only until ELEC-43 (whether
    # a proxy vote may be attributable on an anonymous election) is decided.
    await svc.db.execute(
        text("UPDATE elections SET anonymous_voting = 0 WHERE id = :id"),
        {"id": data["election_id"]},
    )
    record, err = await svc.add_proxy_authorization(
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        delegating_user_id=uuid.UUID(delegating),
        proxy_user_id=uuid.UUID(proxy),
        proxy_type="general",
        reason="away on deployment",
        authorized_by=uuid.UUID(data["user1_id"]),
    )
    return record, err


async def _proxy_vote(
    svc: ElectionService,
    data,
    auth_id: str,
    candidate: str,
    position: str | None = "Chief",
    **kw,
):
    return await svc.cast_proxy_vote(
        proxy_user_id=uuid.UUID(data["user3_id"]),
        election_id=uuid.UUID(data["election_id"]),
        candidate_id=uuid.UUID(candidate),
        proxy_authorization_id=auth_id,
        position=position,
        organization_id=uuid.UUID(data["org_id"]),
        **kw,
    )


ITEM_ID = "chief_seat"
ITEM_TITLE = "Fire Chief"


async def _make_ballot_item_election(db_session: AsyncSession, data, method: str):
    """Turn the positional fixture into a ballot-item election whose one
    legacy item (no explicit "position") keys its candidates by id — the
    shape for which the signed-in ballot sends no position at all."""
    await db_session.execute(
        text(
            "UPDATE elections SET positions = '[]', ballot_items = :items, "
            "voting_method = :m WHERE id = :id"
        ),
        {
            "items": json.dumps(
                [
                    {
                        "id": ITEM_ID,
                        "type": "officer_election",
                        "title": ITEM_TITLE,
                        "vote_type": "candidate_selection",
                    }
                ]
            ),
            "m": method,
            "id": data["election_id"],
        },
    )
    await db_session.execute(
        text("UPDATE candidates SET position = :pos WHERE election_id = :id"),
        {"pos": ITEM_ID, "id": data["election_id"]},
    )
    await db_session.flush()


async def _own_vote(svc: ElectionService, data, candidate: str):
    return await svc.cast_vote(
        user_id=uuid.UUID(data["user2_id"]),
        election_id=uuid.UUID(data["election_id"]),
        candidate_id=uuid.UUID(candidate),
        position=None,
        organization_id=uuid.UUID(data["org_id"]),
    )


async def _vote_rows(db_session: AsyncSession, election_id: str) -> int:
    result = await db_session.execute(
        text("SELECT COUNT(*) FROM votes WHERE election_id = :id"),
        {"id": election_id},
    )
    return int(result.scalar_one())


@pytest.mark.integration
class TestProxyVoteParity(TestElectionSetup):
    async def test_approval_proxy_can_approve_second_candidate(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _enable_proxy_voting(db_session, data["org_id"])
        await _set_method(db_session, data["election_id"], "approval")
        svc = ElectionService(db_session)

        auth, err = await _authorize(svc, data, data["user2_id"], data["user3_id"])
        assert err is None, err

        _, err = await _proxy_vote(svc, data, auth["id"], data["candidate_a_id"])
        assert err is None, err
        _, err = await _proxy_vote(svc, data, auth["id"], data["candidate_b_id"])
        assert err is None, (
            "approval voting records one vote per approved candidate "
            f"(cast_vote allows it); the proxy route refused: {err}"
        )

    async def test_ranked_proxy_vote_requires_rank(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _enable_proxy_voting(db_session, data["org_id"])
        await _set_method(db_session, data["election_id"], "ranked_choice")
        svc = ElectionService(db_session)

        auth, err = await _authorize(svc, data, data["user2_id"], data["user3_id"])
        assert err is None, err

        vote, err = await _proxy_vote(
            svc, data, auth["id"], data["candidate_a_id"], vote_rank=None
        )
        assert err, (
            "cast_vote rejects a ranked-choice ballot without vote_rank; "
            "the proxy route stored an unranked vote"
        )
        assert vote is None

    async def test_simple_proxy_vote_rejects_rank(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _enable_proxy_voting(db_session, data["org_id"])
        svc = ElectionService(db_session)

        auth, err = await _authorize(svc, data, data["user2_id"], data["user3_id"])
        assert err is None, err

        vote, err = await _proxy_vote(
            svc, data, auth["id"], data["candidate_a_id"], vote_rank=2
        )
        assert err, (
            "cast_vote rejects vote_rank on a simple-majority ballot; "
            "the proxy route stored a ranked vote"
        )
        assert vote is None


@pytest.mark.integration
class TestProxyVoteResolvesTheItemLikeCastVote(TestElectionSetup):
    """The proxy route used to hash and compare the raw client position, so
    on a ballot-item election a member's own vote (stored under the item id)
    and a proxy vote with no position for the same member never collided —
    one member, two counted approvals."""

    async def test_no_position_proxy_vote_collides_with_own_approval(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _enable_proxy_voting(db_session, data["org_id"])
        await _make_ballot_item_election(db_session, data, "approval")
        svc = ElectionService(db_session)

        auth, err = await _authorize(svc, data, data["user2_id"], data["user3_id"])
        assert err is None, err

        _, err = await _own_vote(svc, data, data["candidate_a_id"])
        assert err is None, err

        vote, err = await _proxy_vote(
            svc, data, auth["id"], data["candidate_a_id"], position=None
        )
        assert vote is None, (
            "the delegating member already approved this candidate in-app; "
            "the proxy route counted a second approval"
        )
        assert err
        assert "already voted for this candidate" in err
        assert await _vote_rows(db_session, data["election_id"]) == 1

    async def test_duplicate_message_names_the_item_title_not_its_id(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _enable_proxy_voting(db_session, data["org_id"])
        await _make_ballot_item_election(db_session, data, "simple_majority")
        svc = ElectionService(db_session)

        auth, err = await _authorize(svc, data, data["user2_id"], data["user3_id"])
        assert err is None, err

        _, err = await _own_vote(svc, data, data["candidate_a_id"])
        assert err is None, err

        vote, err = await _proxy_vote(
            svc, data, auth["id"], data["candidate_b_id"], position=None
        )
        assert vote is None
        assert err
        assert ITEM_ID not in err, err
        assert await _vote_rows(db_session, data["election_id"]) == 1


@pytest.mark.integration
class TestMaxProxiesPerPerson(TestElectionSetup):
    async def test_second_delegation_to_same_proxy_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _enable_proxy_voting(db_session, data["org_id"], max_per_person=1)
        svc = ElectionService(db_session)

        _, err = await _authorize(svc, data, data["user1_id"], data["user3_id"])
        assert err is None, err

        record, err = await _authorize(svc, data, data["user2_id"], data["user3_id"])
        assert err, (
            "max_proxies_per_person=1 but the same member was authorized as "
            "proxy for a second delegating member"
        )
        assert record is None


@pytest.mark.unit
class TestMaxProxiesPerPersonBounds:
    """W50-49: the settings API accepted any integer for the cap — 111 was
    saved behind "All changes saved" and 0 would refuse every delegation."""

    @pytest.mark.parametrize("value", [0, -1, 11, 111])
    def test_out_of_range_cap_is_rejected(self, value):
        with pytest.raises(ValidationError, match="max_proxies_per_person"):
            ElectionSettingsUpdate.model_validate({"max_proxies_per_person": value})

    @pytest.mark.parametrize("value", [1, 10])
    def test_in_range_cap_is_accepted(self, value):
        update = ElectionSettingsUpdate.model_validate(
            {"max_proxies_per_person": value}
        )
        assert update.model_dump(exclude_unset=True) == {
            "max_proxies_per_person": value
        }
