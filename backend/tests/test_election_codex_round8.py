"""
Elections — regression test for the round-8 Codex review on PR #2173.

PR #2173 (round 7's follow-up) introduced the shared
``_token_eligibility_error()`` helper (ELEC-33) to detect when a ballot
item's position/title/id collides with a restricted plain
``election.positions`` entry. Codex posted one finding against an earlier
commit in that same PR (097f1c37e), about the collision-detection logic
the ELEC-33 fix itself added:

(ELEC-36, P1) When a candidate's ballot item collides with a restricted
plain position under *multiple* aliases at once — a legacy item (no
explicit "position" field) whose ``id`` equals one configured plain
position's name AND whose ``title`` equals a *different* configured plain
position's name, both present in ``election.positions`` — the helper
computed ``colliding_positions`` as a set of every colliding alias and then
picked one via ``next(iter(colliding_positions))`` to check eligibility
against. Python set iteration order depends on hash seeding, not which
alias is "the" position this vote is actually for, so a token eligible for
only ONE of the two colliding positions could have its candidate checked
against the alias it *is* eligible for — bypassing the other alias's
positional eligibility restriction entirely, depending on nothing more
than hash seed luck.

Concretely: item ``{"id": "Treasurer", "title": "Secretary"}`` with both
"Treasurer" and "Secretary" configured as plain, independently-restricted
positions. A token eligible for "Treasurer" but NOT "Secretary" must still
be rejected, because this item also collides with "Secretary" and the
token holds no credential for it — but the arbitrary single-member pick
could clear the token against "Treasurer" instead and let the vote through.

Fixed by requiring eligibility for *every* colliding position, not one
arbitrarily chosen member of the set — failing closed on the ambiguity
instead of guessing which alias is "real". `_token_eligibility_error()` is
the only place this logic lives (grep confirms exactly two call sites,
``cast_vote_with_token`` and ``submit_ballot_with_token``, both already
routed through the shared helper per ELEC-33's own goal), so the fix
closes both routes at once.

Both directions are exercised in one process so at least one is guaranteed
to fail pre-fix regardless of hash seed: pre-fix, ``next(iter(...))``
returns the *same* arbitrary member for both tests (same set contents, same
process), so whichever alias it favors, the mirror-image test where the
token holds the *other* alias's credential incorrectly passes.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

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
            "slug": f"r8-{org_id[:8]}",
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
            "VALUES (:id, :org, :un, 'Round8', :ln, :em, 'hashed', "
            "'active', 'operational')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"r8-{user_id[:8]}",
            "ln": name,
            "em": f"r8-{user_id[:8]}@test.com",
        },
    )
    return user_id


class TestMultiCollisionRequiresEligibilityForEveryColludingPosition:
    """One legacy ballot item whose id ("Treasurer") and title ("Secretary")
    each separately collide with a *different* restricted plain position —
    both present in ``election.positions`` at once."""

    @pytest.fixture
    async def setup_dual_collision_election(self, db_session: AsyncSession):
        org_id = await _make_org(db_session, name="Round8 Dual Collision FD")
        voter_id = await _make_user(db_session, org_id, name="Voter")
        election_id = _uid()
        candidate_id = _uid()
        salt = secrets.token_hex(32)
        now = datetime.now(timezone.utc)

        # Legacy item: no explicit "position" field, so it claims BOTH its
        # id ("Treasurer") and its title ("Secretary") via the
        # ballot_item_candidate_positions fallback — and both happen to
        # also be configured as plain, independently-restricted positions.
        ballot_items = (
            '[{"id": "Treasurer", "type": "officer_election", '
            '"title": "Secretary", "eligible_voter_types": ["all"]}]'
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
                "VALUES (:id, :org, 'Round8 Dual Collision Election', "
                "'general', :positions, :items, :start, :end, 'open', 1, 0, "
                "1, 'simple_majority', 'most_votes', :salt, 'none', "
                ":creator, 0, 0, 0, 'top_two', 3, 0, 0, NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps(["Treasurer", "Secretary"]),
                "items": ballot_items,
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": salt,
                "creator": voter_id,
            },
        )
        # Candidate keyed under the item's title — the historical
        # single-vote-route convention (see ballot_item_candidate_positions)
        # — which is one of the two colliding aliases.
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, nomination_date, created_at, updated_at) "
                "VALUES (:id, :eid, 'Dual Collision Candidate', 'Secretary', "
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

    async def _issue_token(self, db_session, data, *, eligible_positions):
        svc = ElectionService(db_session)
        _token, raw = await svc._generate_voting_token(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
            eligible_item_ids=["Treasurer"],
            eligible_positions=eligible_positions,
        )
        await db_session.flush()
        return raw

    async def _submit(self, db_session, raw, data):
        svc = ElectionService(db_session)
        return await svc.submit_ballot_with_token(
            token=raw,
            votes=[
                {
                    "ballot_item_id": "Treasurer",
                    "choice": data["candidate_id"],
                }
            ],
        )

    async def test_rejects_when_eligible_for_treasurer_but_not_secretary(
        self, db_session: AsyncSession, setup_dual_collision_election
    ):
        """Root cause: pre-fix, an arbitrary member of {"Treasurer",
        "Secretary"} was checked against eligible_positions. If that
        arbitrary pick happened to be "Treasurer" (which this token DOES
        hold), the vote was wrongly accepted despite the token having no
        credential for the item's other colliding alias, "Secretary"."""
        data = setup_dual_collision_election
        raw = await self._issue_token(
            db_session, data, eligible_positions=["Treasurer"]
        )

        result, error = await self._submit(db_session, raw, data)

        assert result is None, (
            "A token ineligible for the colliding 'Secretary' position "
            "must not be able to submit this candidate merely because it "
            "holds a credential for the item's OTHER colliding alias, "
            f"'Treasurer' (ELEC-36); got result={result!r}"
        )
        assert error is not None
        assert "not eligible" in error

    async def test_rejects_when_eligible_for_secretary_but_not_treasurer(
        self, db_session: AsyncSession, setup_dual_collision_election
    ):
        """Mirror image of the above: a token eligible for "Secretary" but
        not "Treasurer" must also be rejected. Run together with the test
        above, one of the two is guaranteed to fail pre-fix regardless of
        which arbitrary member hash-seeding favors, since both tests
        iterate the identical {"Treasurer", "Secretary"} set contents
        within the same process."""
        data = setup_dual_collision_election
        raw = await self._issue_token(
            db_session, data, eligible_positions=["Secretary"]
        )

        result, error = await self._submit(db_session, raw, data)

        assert result is None, (
            "A token ineligible for the colliding 'Treasurer' position "
            "must not be able to submit this candidate merely because it "
            "holds a credential for the item's OTHER colliding alias, "
            f"'Secretary' (ELEC-36); got result={result!r}"
        )
        assert error is not None
        assert "not eligible" in error

    async def test_accepts_when_eligible_for_both_colliding_positions(
        self, db_session: AsyncSession, setup_dual_collision_election
    ):
        """Sanity check: the fix must not over-reject. A token eligible
        under BOTH colliding aliases must still succeed."""
        data = setup_dual_collision_election
        raw = await self._issue_token(
            db_session, data, eligible_positions=["Treasurer", "Secretary"]
        )

        result, error = await self._submit(db_session, raw, data)

        assert error is None, f"Fully-eligible token wrongly rejected: {error}"
        assert result is not None
        assert result["votes_cast"] == 1
