"""
Elections — regression tests for the round-7 Codex review on PR #2162.

PR #2162 merged (commit 14cfb3bdc) while this round's findings were still
being verified, so the fix lands via a follow-up PR instead of further
commits to the closed #2162. Codex posted 2 findings against commit
44fcbfe8e (round 5's ELEC-29 fix), both about gaps in that fix (and, for
the second finding, round 2's ELEC-27 fix) specifically in the bulk
ballot submission path (``submit_ballot_with_token``, the
``/ballot/vote/bulk`` route), which neither earlier round touched; a third
finding surfaced during triage of those two, in the positional-eligibility
snapshot round 6 (ELEC-30) already touched. All three were verified real:

1. (ELEC-33, P1) ``cast_vote_with_token`` (the single-vote route) and
   ``lookup_ballot_by_token`` both detect when a ballot item's
   position/title/id collides with a restricted plain ``election.positions``
   entry (ELEC-29) and require the candidate to clear the position's
   ``eligible_positions`` snapshot too, not just the item's
   ``eligible_item_ids``. ``submit_ballot_with_token`` (the bulk route) was
   never updated to do the same: it only ever checked ``eligible_item_ids``,
   so a token eligible for a colliding item but NOT eligible for the
   colliding plain position (``eligible_positions=[]``) could still submit
   that position's candidate through the bulk route.

2. (ELEC-34, P1) For a legacy ballot item (no explicit "position" field),
   the bulk route stores ``Vote.position`` as the item's id, while the
   single-vote route stores it as the resolved candidate's own ``position``
   value (typically the item's title, per the ELEC-22 title-or-id
   fallback). Each route's duplicate-vote check, and each route's
   ``vote_dedup_hash`` (the database-level UNIQUE-constraint backstop),
   only ever compared against its own route's convention — so a voter
   holding two unused tokens could cast one vote for the same contest
   through each route and have both counted.

3. (ELEC-35, P1) Round 6's ELEC-30 fix made the positional-eligibility
   snapshot in ``send_ballot_emails`` call ``_member_voting_gates()`` (the
   global membership-tier voting ban) only inside the
   ``if election.positions and election.position_eligibility:`` branch.
   Round 6's own fixture covered a position with an *empty rule*
   (``position_eligibility`` truthy). An election with plain positions and
   NO ``position_eligibility`` configured at all (a falsy ``{}``/``None``)
   skipped the branch — and the tier gate — entirely, leaving
   ``eligible_positions`` at its ``None`` default, which the vote path
   reads as unrestricted.

Fixed by:

- Extracting the ELEC-29 collision check into a shared
  ``_token_eligibility_error`` helper (module-level in
  ``election_service.py``), used by both ``cast_vote_with_token`` and
  ``submit_ballot_with_token``, so a fourth call site cannot drift from the
  other two again (ELEC-33). The helper also fixes a latent gap in the
  original ELEC-29 collision test itself: collision is detected via *any*
  alias in ``ballot_item_candidate_positions(item)``, not just whichever
  literal a given route happened to resolve to — the bulk route's
  resolved position for a legacy item is its id, which can never itself
  equal a plain position name even though the item's *title* does.
- Widening both routes' duplicate-vote SELECT to match every alias in
  ``ballot_item_candidate_positions(item)`` instead of a single literal,
  and normalizing the ``vote_dedup_hash`` position component
  (``_dedup_position_key``) to the item id for a legacy item regardless of
  route, so the two routes see (and hash) each other's rows (ELEC-34).
- Evaluating ``_member_voting_gates()`` whenever ``election.positions`` is
  set, independent of whether ``position_eligibility`` is configured, so
  the absence of position-specific rules is no longer read as an exemption
  from the tier ban (ELEC-35).
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import VotingToken
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db_session: AsyncSession, *, name: str, settings=None) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC', :settings)"
        ),
        {
            "id": org_id,
            "name": name,
            "slug": f"r7-{org_id[:8]}",
            "settings": (None if settings is None else json.dumps(settings)),
        },
    )
    return org_id


async def _make_user(
    db_session: AsyncSession,
    org_id: str,
    *,
    name: str,
    membership_type: str = "operational",
) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, 'Round7', :ln, :em, 'hashed', "
            "'active', :mt)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"r7-{user_id[:8]}",
            "ln": name,
            "em": f"r7-{user_id[:8]}@test.com",
            "mt": membership_type,
        },
    )
    return user_id


# ===================================================================
# Finding 1 (ELEC-33) — the bulk route must enforce positional scope for
# a ballot item that collides with a restricted plain position
# ===================================================================


class TestBulkRouteEnforcesPositionalScopeForCollidingItem:
    @pytest.fixture
    async def setup_colliding_election(self, db_session: AsyncSession):
        """One OPEN election with:

        - a plain position "Secretary" restricted to administrative members
          via ``position_eligibility``
        - an UNRESTRICTED legacy ballot item titled "Secretary" (no
          explicit "position" field, so it claims "Secretary" via the
          title fallback — colliding with the plain position of the same
          name, per ELEC-29)
        - a single candidate running for position "Secretary", claimed by
          BOTH namespaces at once
        """
        org_id = await _make_org(db_session, name="Round7 Collision FD")
        voter_id = await _make_user(db_session, org_id, name="Voter")
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = (
            '[{"id": "legacy_secretary", "type": "officer_election", '
            '"title": "Secretary", "eligible_voter_types": ["all"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "position_eligibility, ballot_items, start_date, end_date, "
                "status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round7 Collision Election', 'general', "
                ":positions, :pos_elig, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": '["Secretary"]',
                "pos_elig": '{"Secretary": {"voter_types": ["administrative"]}}',
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": voter_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Secretary Candidate', 'Secretary', 1, "
                "0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "voter_id": voter_id,
            "election_id": election_id,
            "candidate_id": candidate_id,
            "salt": salt,
        }

    async def _issue_mismatched_token(self, db_session, data):
        """Eligible for the unrestricted legacy item but NOT for the
        restricted plain "Secretary" position — the exact shape
        ``send_ballot_emails`` produces for an operational recipient."""
        svc = ElectionService(db_session)
        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["legacy_secretary"],
            eligible_positions=[],
        )
        await db_session.flush()
        return raw

    async def test_submit_ballot_rejects_colliding_candidate(
        self, db_session: AsyncSession, setup_colliding_election
    ):
        """Root cause: pre-fix, the bulk route only ever checked
        ``eligible_item_ids`` (which this token satisfies) and never
        consulted ``eligible_positions`` (empty for this token) for the
        colliding plain position. Must now be rejected."""
        data = setup_colliding_election
        svc = ElectionService(db_session)
        raw = await self._issue_mismatched_token(db_session, data)

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {
                    "ballot_item_id": "legacy_secretary",
                    "choice": data["candidate_id"],
                }
            ],
        )

        assert result is None, (
            "A token ineligible for the restricted plain 'Secretary' "
            "position must not be able to submit this candidate through "
            f"the bulk route merely because it is eligible for a "
            f"same-named, unrestricted ballot item (ELEC-33); got "
            f"result={result!r}"
        )
        assert error is not None
        assert "not eligible" in error

        stored = (
            (
                await db_session.execute(
                    text("SELECT id FROM votes WHERE election_id = :eid"),
                    {"eid": data["election_id"]},
                )
            )
            .mappings()
            .all()
        )
        assert stored == [], "No vote should be persisted for the rejected submission"

    async def test_submit_ballot_accepts_when_both_scopes_allow(
        self, db_session: AsyncSession, setup_colliding_election
    ):
        """Sanity check: the fix must not over-reject. A token eligible
        under BOTH the item and the plain position must still succeed."""
        data = setup_colliding_election
        svc = ElectionService(db_session)
        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["legacy_secretary"],
            eligible_positions=["Secretary"],
        )
        await db_session.flush()

        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {
                    "ballot_item_id": "legacy_secretary",
                    "choice": data["candidate_id"],
                }
            ],
        )
        assert error is None, f"Fully-eligible token wrongly rejected: {error}"
        assert result is not None
        assert result["votes_cast"] == 1


# ===================================================================
# Finding 2 (ELEC-34) — a legacy ballot item's votes must dedup across
# BOTH the single-vote and bulk routes, regardless of which stored which
# convention
# ===================================================================


class TestLegacyItemVoteDedupAcrossBothRoutes:
    @pytest.fixture
    async def setup_legacy_item_election(self, db_session: AsyncSession):
        """One OPEN election with a single legacy ballot item (no explicit
        "position" field, so it is keyed by title/id fallback per
        ``ballot_item_candidate_positions``) and two accepted candidates,
        both keyed under the item's *title* — the historical convention
        for legacy-item candidates (see ELEC-22)."""
        org_id = await _make_org(db_session, name="Round7 Dedup FD")
        voter_id = await _make_user(db_session, org_id, name="Voter")
        election_id = _uid()
        candidate_1_id = _uid()
        candidate_2_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = (
            '[{"id": "board_seat", "type": "officer_election", '
            '"title": "Board Seat", "eligible_voter_types": ["all"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, start_date, end_date, status, "
                "anonymous_voting, allow_write_ins, max_votes_per_position, "
                "voting_method, victory_condition, voter_anonymity_salt, "
                "quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round7 Dedup Election', 'general', "
                "NULL, :items, :start, :end, 'open', 1, 0, 1, "
                "'simple_majority', 'most_votes', :salt, 'none', :creator, "
                "0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": voter_id,
            },
        )
        for cand_id, name, order in (
            (candidate_1_id, "Board Candidate One", 0),
            (candidate_2_id, "Board Candidate Two", 1),
        ):
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, "
                    "is_write_in, display_order, nomination_date, "
                    "created_at, updated_at) "
                    "VALUES (:id, :eid, :name, 'Board Seat', 1, 0, :ord, "
                    "NOW(), NOW(), NOW())"
                ),
                {
                    "id": cand_id,
                    "eid": election_id,
                    "name": name,
                    "ord": order,
                },
            )
        await db_session.flush()

        return {
            "org_id": org_id,
            "voter_id": voter_id,
            "election_id": election_id,
            "candidate_1_id": candidate_1_id,
            "candidate_2_id": candidate_2_id,
            "salt": salt,
        }

    async def _issue_token(self, svc, db_session, data):
        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["board_seat"],
            eligible_positions=None,
        )
        await db_session.flush()
        return raw

    async def _vote_count(self, db_session: AsyncSession, election_id: str) -> int:
        result = await db_session.execute(
            text("SELECT COUNT(*) AS n FROM votes WHERE election_id = :eid"),
            {"eid": election_id},
        )
        return result.mappings().first()["n"]

    async def test_bulk_then_single_vote_rejects_the_second(
        self, db_session: AsyncSession, setup_legacy_item_election
    ):
        """Root cause: the bulk route stores Vote.position as the item id
        ("board_seat"); the single-vote route stores it as the resolved
        candidate's own position (the title, "Board Seat"). Pre-fix,
        neither route's duplicate check saw the other's literal, so both
        votes were recorded for the same voter/contest."""
        data = setup_legacy_item_election
        svc = ElectionService(db_session)

        raw_1 = await self._issue_token(svc, db_session, data)
        result, error = await svc.submit_ballot_with_token(
            token=raw_1,
            votes=[
                {
                    "ballot_item_id": "board_seat",
                    "choice": data["candidate_1_id"],
                }
            ],
        )
        assert error is None, f"First (bulk) vote unexpectedly rejected: {error}"
        assert result is not None
        assert result["votes_cast"] == 1

        raw_2 = await self._issue_token(svc, db_session, data)
        vote, error2 = await svc.cast_vote_with_token(
            token=raw_2,
            candidate_id=uuid.UUID(data["candidate_2_id"]),
            position=None,
        )

        assert vote is None, (
            "A second token for the same voter must not be able to cast a "
            "second vote on the same legacy ballot item through the "
            f"single-vote route (ELEC-34); got vote={vote!r}"
        )
        assert error2 is not None
        assert "already voted" in error2

        assert await self._vote_count(db_session, data["election_id"]) == 1, (
            "Exactly one vote may be recorded for this voter/contest across "
            "both routes"
        )

    async def test_single_then_bulk_vote_rejects_the_second(
        self, db_session: AsyncSession, setup_legacy_item_election
    ):
        """Same contest, opposite order: a single-vote-route vote cast
        first must be visible to the bulk route's duplicate check too."""
        data = setup_legacy_item_election
        svc = ElectionService(db_session)

        raw_1 = await self._issue_token(svc, db_session, data)
        vote, error = await svc.cast_vote_with_token(
            token=raw_1,
            candidate_id=uuid.UUID(data["candidate_1_id"]),
            position=None,
        )
        assert error is None, f"First (single-vote) vote unexpectedly rejected: {error}"
        assert vote is not None

        raw_2 = await self._issue_token(svc, db_session, data)
        result, error2 = await svc.submit_ballot_with_token(
            token=raw_2,
            votes=[
                {
                    "ballot_item_id": "board_seat",
                    "choice": data["candidate_2_id"],
                }
            ],
        )

        assert result is None, (
            "A second token for the same voter must not be able to cast a "
            "second vote on the same legacy ballot item through the bulk "
            f"route (ELEC-34); got result={result!r}"
        )
        assert error2 is not None
        assert "already voted" in error2

        assert await self._vote_count(db_session, data["election_id"]) == 1

    async def test_dedup_hashes_match_across_routes_for_a_legacy_item(self):
        """Defense in depth: even bypassing the pre-insert SELECT check
        (e.g. a genuine concurrent race between the two tokens), the
        database's UNIQUE constraint on ``vote_dedup_hash`` must still
        catch the collision — which requires both routes to hash the same
        canonical position value for this legacy item, not each route's
        own display convention."""
        from app.services.election_service import _dedup_position_key

        item = {"id": "board_seat", "title": "Board Seat"}

        # Bulk route's stored/hashed value (item id).
        bulk_position = item.get("position") or item["id"]
        # Single-vote route's effective_position for a candidate keyed by
        # the item's title (the historical convention) — matching_item
        # resolves via the title alias.
        single_effective_position = "Board Seat"

        bulk_dedup_key = _dedup_position_key(item, bulk_position)
        single_dedup_key = _dedup_position_key(item, single_effective_position)

        assert bulk_dedup_key == single_dedup_key == "board_seat", (
            "Both routes must compute the same dedup-hash position key for "
            f"a legacy item; got bulk={bulk_dedup_key!r} "
            f"single={single_dedup_key!r}"
        )


# ===================================================================
# Finding 3 (ELEC-35) — the tier voting ban must exclude a member from
# every plain position even when the election configures NO
# position_eligibility rules at all, not just when a named position has an
# empty rule (round 6's ELEC-30 scenario)
# ===================================================================


class TestTierBanAppliesWithoutAnyPositionEligibilityRules:
    @pytest.fixture
    async def setup_no_rules_election(self, db_session: AsyncSession):
        """A mixed OPEN election with a plain position ("President") and
        NO `position_eligibility` configured at all (a falsy `{}`, not an
        empty rule keyed to "President" — that distinction is exactly what
        ELEC-35 is about: round 6 only fixed the latter)."""
        org_id = await _make_org(
            db_session,
            name="Round7 No-Rules Tier FD",
            settings={
                "membership_tiers": {
                    "tiers": [
                        {
                            "id": "probationary",
                            "name": "Probationary",
                            "benefits": {"voting_eligible": False},
                        }
                    ]
                }
            },
        )
        banned_member_id = await _make_user(
            db_session,
            org_id,
            name="Banned Voter",
            membership_type="probationary",
        )
        eligible_member_id = await _make_user(
            db_session, org_id, name="Eligible Voter", membership_type="active"
        )
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "position_eligibility, start_date, end_date, status, "
                "anonymous_voting, allow_write_ins, max_votes_per_position, "
                "voting_method, victory_condition, voter_anonymity_salt, "
                "quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round7 No-Rules Election', 'general', "
                ":positions, :pos_elig, :start, :end, 'open', 1, 0, 1, "
                "'simple_majority', 'most_votes', :salt, 'none', :creator, "
                "0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                # No position_eligibility rules at all — falsy, not an
                # empty-rule entry for "President" (round 6's scenario).
                "positions": '["President"]',
                "pos_elig": "{}",
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": eligible_member_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'President Candidate', 'President', 1, "
                "0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "banned_member_id": banned_member_id,
            "eligible_member_id": eligible_member_id,
            "election_id": election_id,
            "candidate_id": candidate_id,
            "salt": salt,
        }

    async def test_tier_banned_member_gets_no_positional_credential(
        self, db_session: AsyncSession, setup_no_rules_election
    ):
        """Root cause: with position_eligibility entirely absent, the old
        code never called `_member_voting_gates()` at all, so
        `eligible_positions` stayed at its `None` default — read as
        unrestricted downstream. This banned member must instead be
        skipped entirely, exactly as round 6 already guarantees when a
        rule (even an empty one) exists for "President"."""
        data = setup_no_rules_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["banned_member_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )

        assert sent == 0, (
            "A globally voting-ineligible member must not receive a ballot "
            "granting a live positional credential merely because no "
            f"position_eligibility rules exist (ELEC-35) "
            f"(failed={failed}, skipped_details={skipped_details})"
        )
        assert skipped == 1

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
        assert len(tokens) == 0, (
            "No token — and therefore no unrestricted eligible_positions=None "
            "credential — may be issued to a member whose tier bans voting "
            "outright, regardless of whether position_eligibility rules exist"
        )

    async def test_voting_eligible_member_still_gets_unrestricted_position(
        self, db_session: AsyncSession, setup_no_rules_election
    ):
        """Sanity check: the fix must not over-reject. A member whose tier
        permits voting must still receive the position, unrestricted, when
        no position_eligibility rules exist for it."""
        data = setup_no_rules_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["eligible_member_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )
        assert sent == 1, f"skipped_details={skipped_details}"
        assert skipped == 0

        token_row = (
            (
                await db_session.execute(
                    select(VotingToken).where(
                        VotingToken.election_id == data["election_id"]
                    )
                )
            )
            .scalars()
            .first()
        )
        assert token_row is not None
        assert token_row.eligible_positions == ["President"], (
            "A voting-eligible member must still receive an unrestricted "
            f"position when no rules exist for it; got "
            f"{token_row.eligible_positions!r}"
        )
