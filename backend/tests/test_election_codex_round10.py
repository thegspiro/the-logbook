"""
Elections — regression tests for the round-10 Codex review on PR #2173.

Codex posted 1 finding against round 9's own fix commit (``16a62a2d5``):

(ELEC-39, P1) ``submit_ballot_with_token``'s backward-compatible ``choice``
UUID form (write-in / approve / deny / a plain candidate id — the one path
that isn't gated to the ``rankings``/``candidate_ids`` branches) hardcoded
its vote_dedup_hash discriminator to ``""`` regardless of the ballot item's
effective voting method. When an item overrides a non-approval election to
``"approval"``, ``cast_vote_with_token`` (the single-vote route) already
resolves ``_dedup_discriminator(..., item=matching_item)`` to
``f"cand:{candidate_id}"`` for that same candidate/item (ELEC-37, round 9)
— so the two routes hashed the identical logical vote differently, and a
token racing through the ``choice`` form on the bulk route against the
single-vote route was never caught by the UNIQUE constraint on
``vote_dedup_hash``.

Fixed by routing the ``choice``-form vote through the same
``_dedup_discriminator(election, candidate_id, None, item=ballot_item)``
call the ``candidate_ids``/``rankings`` branches already resolve inline,
instead of a hardcoded ``""``. For every other voting method this still
resolves to ``""`` — byte-identical to rows written before this fix.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote
from app.services.election_service import ElectionService, _dedup_position_key

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_org(db_session: AsyncSession, *, name: str) -> str:
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
            "slug": f"r10-{org_id[:8]}",
            "settings": None,
        },
    )
    return org_id


async def _make_user(db_session: AsyncSession, org_id: str, *, name: str) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, 'Round10', :ln, :em, 'hashed', "
            "'active', 'operational')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"r10-{user_id[:8]}",
            "ln": name,
            "em": f"r10-{user_id[:8]}@test.com",
        },
    )
    return user_id


class TestBulkChoiceFormDiscriminatorHonorsItemVotingMethodOverride:
    """Unit-level tests mirroring round 9's own
    ``TestDedupDiscriminatorHonorsItemVotingMethodOverride`` — these prove
    the discriminator VALUE the bulk route's `choice` form now resolves to,
    which is the input the end-to-end test below confirms is what actually
    gets persisted.
    """

    def test_choice_form_uses_cand_prefix_for_an_approval_override(self):
        election = SimpleNamespace(
            voting_method="simple_majority", max_votes_per_position=1
        )
        item = {
            "id": "budget",
            "title": "Budget Approval",
            "voting_method": "approval",
        }
        candidate_id = "33333333-3333-3333-3333-333333333333"

        discriminator = ElectionService._dedup_discriminator(
            election, candidate_id, None, item=item
        )

        assert discriminator == f"cand:{candidate_id}", (
            "The bulk route's `choice` UUID form must hash an "
            "approval-overridden item's vote the same way the single-vote "
            "route does, or a race between the two routes bypasses the "
            f"UNIQUE constraint on vote_dedup_hash; got {discriminator!r}"
        )

    def test_choice_form_still_uses_empty_discriminator_for_a_plain_election(self):
        election = SimpleNamespace(
            voting_method="simple_majority", max_votes_per_position=1
        )
        item = {"id": "board", "title": "Board Seat"}
        candidate_id = "44444444-4444-4444-4444-444444444444"

        discriminator = ElectionService._dedup_discriminator(
            election, candidate_id, None, item=item
        )

        assert discriminator == ""


class TestBulkChoiceFormEndToEndDedupHash:
    """The actual persisted ``vote_dedup_hash`` from a real
    ``submit_ballot_with_token`` call, through its ``choice`` UUID branch,
    must match what ``cast_vote_with_token`` would compute for the
    identical logical vote — a plain unit-level assertion on
    ``_dedup_discriminator`` alone would still pass even if line 8334 were
    reverted to a hardcoded ``""``, since that helper was already correct;
    only exercising the real bulk code path proves the fix took effect."""

    @pytest.fixture
    async def setup_approval_override_election(self, db_session: AsyncSession):
        org_id = await _make_org(db_session, name="Round10 Approval Override FD")
        voter_id = await _make_user(db_session, org_id, name="Voter")
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        ballot_items = json.dumps(
            [
                {
                    "id": "budget",
                    "type": "membership_approval",
                    "title": "Budget Approval",
                    "voting_method": "approval",
                    "eligible_voter_types": ["all"],
                }
            ]
        )
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, start_date, end_date, "
                "status, anonymous_voting, allow_write_ins, "
                "max_votes_per_position, voting_method, victory_condition, "
                "voter_anonymity_salt, quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, created_at, "
                "updated_at) "
                "VALUES (:id, :org, 'Round10 Approval Override Election', "
                "'general', :positions, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps([]),
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": voter_id,
            },
        )
        # A legacy candidate for the item — keyed by the item's title, the
        # historical single-vote-route convention (candidate.position).
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Budget Candidate', 'Budget Approval', "
                "1, 0, 0, NOW(), NOW(), NOW())"
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

    async def test_bulk_choice_form_hash_matches_single_vote_route(
        self, db_session: AsyncSession, setup_approval_override_election
    ):
        data = setup_approval_override_election
        svc = ElectionService(db_session)

        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["budget"],
            eligible_positions=None,
        )
        await db_session.flush()

        # The backward-compatible `choice` UUID form — not `candidate_ids`
        # — is the branch that hardcoded "" pre-fix.
        result, error = await svc.submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": "budget", "choice": data["candidate_id"]}],
        )
        assert error is None, f"Vote unexpectedly rejected: {error}"
        assert result is not None

        stored = (
            await db_session.execute(
                select(Vote).where(
                    Vote.election_id == data["election_id"],
                    Vote.candidate_id == data["candidate_id"],
                )
            )
        ).scalar_one()

        election_row = (
            (
                await db_session.execute(
                    text(
                        "SELECT voting_method, max_votes_per_position FROM elections "
                        "WHERE id = :id"
                    ),
                    {"id": data["election_id"]},
                )
            )
            .mappings()
            .one()
        )
        election = SimpleNamespace(
            voting_method=election_row["voting_method"],
            max_votes_per_position=election_row["max_votes_per_position"],
        )
        item = {
            "id": "budget",
            "title": "Budget Approval",
            "voting_method": "approval",
        }

        # What cast_vote_with_token would hash for this exact logical vote.
        effective_position = item["title"]
        single_position = _dedup_position_key(item, effective_position)
        single_discriminator = ElectionService._dedup_discriminator(
            election, data["candidate_id"], None, item=item
        )
        single_hash = ElectionService._compute_vote_dedup_hash(
            data["election_id"],
            stored.voter_hash,
            single_position,
            discriminator=single_discriminator,
        )

        assert stored.vote_dedup_hash == single_hash, (
            "The bulk route's `choice` form must persist the SAME "
            "vote_dedup_hash the single-vote route would compute for this "
            "approval-overridden item, so a race between the two routes "
            f"is caught by the UNIQUE constraint (ELEC-39); "
            f"stored={stored.vote_dedup_hash!r} expected={single_hash!r}"
        )
