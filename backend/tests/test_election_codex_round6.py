"""
Elections — regression tests for the round-6 Codex review on PR #2162.

Codex posted 3 findings against commit 67511fa77 (round 4's fix), all in
the mixed-election positional-eligibility code `send_ballot_emails` gained
from round 4's ELEC-26 fix, plus the completion check in
`cast_vote_with_token` that consumes its output
(`backend/app/services/election_service.py`, ~lines 6078-6088 and
~7621-7649). Round 5 touched a *different* function
(`cast_vote_with_token`'s candidate classification, ELEC-29) — not this
eligibility-computation code — so all three were still open against current
code. All three were verified real:

1. (ELEC-30, P1) The positional-eligibility snapshot appended an
   unrestricted plain position to `eligible_positions` with no check on the
   member's membership-tier `voting_eligible` flag — the same global ban
   `annotate_ballot_items_for_user` (item eligibility) already enforces for
   every ballot item, regardless of that item's own voter-type rules. A
   member on a tier with `voting_eligible=False` (e.g. the shipped
   "probationary" tier) could still receive a live token/credential for a
   plain-position contest in a mixed election.

2. (ELEC-31, P1) An election's `voter_overrides` (the "secretary override")
   makes `annotate_ballot_items_for_user` treat every ballot item as
   eligible for an overridden recipient, bypassing normal per-item
   voter-type rules — but the positional snapshot never consulted
   `voter_overrides` at all, so an overridden recipient whose role failed a
   restricted position's `voter_types` rule still had that position
   excluded from `eligible_positions`, contradicting the override's
   contract (the override is supposed to waive every scope's rules, not
   just ballot items).

3. (ELEC-32, P2) `cast_vote_with_token`'s completion check ("mark the token
   fully used") measured only `eligible_positions` coverage, never
   consulting `eligible_item_ids`. In a mixed simple-majority election
   where a voter is eligible for at least one ballot item AND a strict
   subset of the plain positions, casting the last eligible *position*
   vote first set `used=True` immediately — even though an eligible item
   vote was still outstanding. The subsequent, entirely legitimate item
   vote was then rejected by `get_ballot_by_token` as "already been fully
   submitted."

Fixed by extracting `ElectionService._member_voting_gates()` — the two
universal gates (global tier ban, election override) `annotate_ballot_items_for_user`
already applied to items — and applying it identically to the positional
snapshot (ELEC-30/31), and by folding each eligible item's candidate-position
label(s) into the same completion set `cast_vote_with_token` already builds
for `eligible_positions`, so "ballot fully cast" requires covering both
scopes at once (ELEC-32).
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
            "slug": f"r6-{org_id[:8]}",
            "settings": (json.dumps(settings) if settings is not None else None),
        },
    )
    return org_id


async def _make_user(
    db_session: AsyncSession, org_id: str, *, membership_type: str = "active"
) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, 'Round6', 'Voter', :em, 'hashed', "
            "'active', :mt)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"r6-{user_id[:8]}",
            "em": f"r6-{user_id[:8]}@test.com",
            "mt": membership_type,
        },
    )
    return user_id


# ===================================================================
# Finding 1 (ELEC-30) — a globally voting-ineligible tier must exclude a
# member from every plain position too, not just every ballot item
# ===================================================================


class TestGloballyIneligibleTierExcludesPositions:
    @pytest.fixture
    async def setup_mixed_election(self, db_session: AsyncSession):
        """A mixed OPEN election: one unrestricted ballot item and one plain
        position with no position-specific rules of its own — so the ONLY
        thing that can exclude a recipient from either scope is the global
        membership-tier voting ban. The recipient's tier ("probationary")
        is configured with benefits.voting_eligible=False."""
        org_id = await _make_org(
            db_session,
            name="Round6 Tier FD",
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
        member_id = await _make_user(db_session, org_id, membership_type="probationary")
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = (
            '[{"id": "board_seat", "type": "officer_election", '
            '"title": "Board Seat", "position": "board_seat", '
            '"eligible_voter_types": ["all"]}]'
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
                "VALUES (:id, :org, 'Round6 Tier Election', 'general', "
                ":positions, :pos_elig, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                # A position with an EMPTY (falsy) rules entry — the "no
                # rules for this position -> everyone may vote" branch this
                # finding is about, not a role restriction.
                "positions": '["President"]',
                "pos_elig": '{"President": {}}',
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": member_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Board Candidate', 'board_seat', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "member_id": member_id,
            "election_id": election_id,
            "salt": salt,
        }

    async def test_globally_banned_tier_gets_no_positional_credential(
        self, db_session: AsyncSession, setup_mixed_election
    ):
        """Root cause: pre-fix, the positional snapshot appended
        "President" unconditionally (no rules configured for it) without
        ever checking the member's tier. Post-fix, the same global
        voting_eligible=False gate that already zeroes eligible_item_ids
        for this member must also zero eligible_positions — so this
        recipient qualifies for NEITHER scope and must be skipped entirely,
        exactly like a globally banned member already is on the item side.
        Pre-fix this recipient wrongly received a live token good for the
        "President" position."""
        data = setup_mixed_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["member_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )

        assert sent == 0, (
            "A globally voting-ineligible member must not receive a ballot "
            f"granting a live position credential (failed={failed}, "
            f"skipped_details={skipped_details})"
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
            "No token — and therefore no eligible_positions credential — "
            "may be issued to a member whose tier bans voting outright"
        )


# ===================================================================
# Finding 2 (ELEC-31) — an election voter override must bypass per-position
# voter_types rules the same way it already bypasses per-item rules
# ===================================================================


class TestVoterOverrideAppliesToPositions:
    @pytest.fixture
    async def setup_override_election(self, db_session: AsyncSession):
        """A mixed OPEN election: one unrestricted ballot item (so the
        overridden recipient always qualifies for *some* ballot and a token
        is actually issued) plus a plain position restricted to
        "operational" voters. The recipient is "administrative" (fails the
        position's voter_types rule on the merits) but is named in
        election.voter_overrides."""
        org_id = await _make_org(db_session, name="Round6 Override FD")
        member_id = await _make_user(
            db_session, org_id, membership_type="administrative"
        )
        election_id = _uid()
        item_candidate_id = _uid()
        president_candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = (
            '[{"id": "board_seat", "type": "officer_election", '
            '"title": "Board Seat", "position": "board_seat", '
            '"eligible_voter_types": ["all"]}]'
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "position_eligibility, ballot_items, voter_overrides, "
                "start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, created_at, updated_at) "
                "VALUES (:id, :org, 'Round6 Override Election', 'general', "
                ":positions, :pos_elig, :items, :overrides, :start, :end, "
                "'open', 1, 0, 1, 'simple_majority', 'most_votes', :salt, "
                "'none', :creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), "
                "NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": '["President"]',
                "pos_elig": '{"President": {"voter_types": ["operational"]}}',
                "items": ballot_items,
                "overrides": (
                    '[{"user_id": "%s", "reason": "test override"}]' % member_id
                ),
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": member_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Board Candidate', 'board_seat', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": item_candidate_id, "eid": election_id},
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'President Candidate', 'President', 1, "
                "0, 1, NOW(), NOW(), NOW())"
            ),
            {"id": president_candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "member_id": member_id,
            "election_id": election_id,
            "president_candidate_id": president_candidate_id,
            "salt": salt,
        }

    async def test_overridden_recipient_gets_positional_credential(
        self, db_session: AsyncSession, setup_override_election
    ):
        """Root cause: pre-fix, the override was never consulted while
        building eligible_positions, so this administrative-but-overridden
        recipient's token snapshot omitted "President" (fails the
        operational-only rule on the merits) even though the override is
        supposed to waive exactly that kind of rule, as it already does for
        ballot items."""
        data = setup_override_election
        svc = ElectionService(db_session)

        with patch(
            "app.services.email_service.EmailService.send_batch",
            new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
        ):
            sent, failed, skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["member_id"])],
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
            "The election override must waive the position's voter_types "
            f"rule the same way it waives item rules; got "
            f"{token_row.eligible_positions!r}"
        )

    async def test_overridden_recipient_can_cast_the_positional_vote(
        self, db_session: AsyncSession, setup_override_election
    ):
        """End-to-end, using the ACTUAL token send_ballot_emails issues (not
        a hand-built one): the override must not just appear in the
        snapshot — the real computed token must be able to cast the
        positional vote through cast_vote_with_token. Pre-fix this failed
        with "You are not eligible to vote for President" because the real
        token's eligible_positions omitted it."""
        data = setup_override_election
        svc = ElectionService(db_session)

        captured_urls = []

        async def _capture_render(**kwargs):
            captured_urls.append(kwargs.get("ballot_url"))
            return ("subject", "<html></html>", "text")

        with (
            patch(
                "app.services.email_service.EmailService.render_ballot_notification",
                new=AsyncMock(side_effect=_capture_render),
            ),
            patch(
                "app.services.email_service.EmailService.send_batch",
                new=AsyncMock(side_effect=lambda batch: [True] * len(batch)),
            ),
        ):
            sent, _failed, _skipped, skipped_details, _sent_ids = (
                await svc.send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["member_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            )
        assert sent == 1, f"skipped_details={skipped_details}"
        assert len(captured_urls) == 1
        raw_token = captured_urls[0].split("#token=")[1]

        vote, error = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["president_candidate_id"]),
            position="President",
        )
        assert error is None, f"Overridden positional vote wrongly rejected: {error}"
        assert vote is not None


# ===================================================================
# Finding 3 (ELEC-32) — cast_vote_with_token must not mark a mixed-election
# token used until BOTH its eligible positions AND eligible items are cast
# ===================================================================


class TestMixedTokenStaysLiveUntilBothScopesCovered:
    @pytest.fixture
    async def setup_mixed_scope_election(self, db_session: AsyncSession):
        """One OPEN simple-majority election with a plain position
        ("Secretary") and a candidate-selection ballot item ("board_seat"),
        where a recipient is eligible for both."""
        org_id = await _make_org(db_session, name="Round6 Completion FD")
        member_id = await _make_user(db_session, org_id)
        election_id = _uid()
        item_candidate_id = _uid()
        secretary_candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = (
            '[{"id": "board_seat", "type": "officer_election", '
            '"title": "Board Seat", "position": "board_seat", '
            '"eligible_voter_types": ["all"]}]'
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
                "VALUES (:id, :org, 'Round6 Completion Election', 'general', "
                ":positions, :pos_elig, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": '["Secretary"]',
                "pos_elig": '{"Secretary": {"voter_types": ["all"]}}',
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": member_id,
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Board Candidate', 'board_seat', 1, 0, 0, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": item_candidate_id, "eid": election_id},
        )
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Secretary Candidate', 'Secretary', 1, "
                "0, 1, NOW(), NOW(), NOW())"
            ),
            {"id": secretary_candidate_id, "eid": election_id},
        )
        await db_session.flush()

        return {
            "org_id": org_id,
            "member_id": member_id,
            "election_id": election_id,
            "item_candidate_id": item_candidate_id,
            "secretary_candidate_id": secretary_candidate_id,
            "salt": salt,
        }

    async def _issue_token(self, svc, db_session, data):
        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["member_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["board_seat"],
            eligible_positions=["Secretary"],
        )
        await db_session.flush()
        return raw

    async def test_positional_vote_first_does_not_close_the_token(
        self, db_session: AsyncSession, setup_mixed_scope_election
    ):
        """Root cause: casting the (only) eligible position must not, by
        itself, mark a mixed-scope token as fully used while an eligible
        ballot item is still outstanding."""
        data = setup_mixed_scope_election
        svc = ElectionService(db_session)
        raw = await self._issue_token(svc, db_session, data)

        vote, error = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["secretary_candidate_id"]),
            position="Secretary",
        )
        assert error is None, f"Eligible positional vote wrongly rejected: {error}"
        assert vote is not None

        refreshed = (
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
        assert refreshed is not None
        assert refreshed.used is False, (
            "The token still owes an eligible ballot-item vote and must "
            "not be marked fully used after only the position is cast"
        )

    async def test_item_vote_still_accepted_after_positional_vote(
        self, db_session: AsyncSession, setup_mixed_scope_election
    ):
        """The token must still accept the outstanding item vote — pre-fix
        this was rejected with 'already been fully submitted' because the
        positional vote alone had already flipped used=True."""
        data = setup_mixed_scope_election
        svc = ElectionService(db_session)
        raw = await self._issue_token(svc, db_session, data)

        vote1, error1 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["secretary_candidate_id"]),
            position="Secretary",
        )
        assert error1 is None
        assert vote1 is not None

        vote2, error2 = await svc.cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["item_candidate_id"]),
            position=None,
        )
        assert error2 is None, (
            "The outstanding eligible item vote must still be accepted "
            f"after the positional vote; got error={error2!r}"
        )
        assert vote2 is not None

        refreshed = (
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
        assert refreshed is not None
        assert (
            refreshed.used is True
        ), "Both scopes are now covered — the token must be fully used"
        assert refreshed.used_at is not None
