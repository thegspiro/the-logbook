"""W50-7: a multi-item ballot's results are grouped per item.

``overall_results`` pooled every contest's candidates into one ranking, so
one motion's Approve competed with another's Deny for a single winner, with
percentages over the whole ballot — and for an item-only ballot (no
configured positions) that pool was what the results screen rendered and
what the runoff check read. The owner decided (2026-10-08) to group per
item: each contest is graded on its own in ``results_by_position`` (now
carrying ``ballot_item_id`` and ``vote_type``), ``overall_results`` keeps
only candidates that belong to no contest, the certified PDF prints one
table per contest, and the runoff check looks at each race.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pypdf import PdfReader
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate, Election, Vote
from app.services.election_service import ElectionService
from app.utils.certified_results_pdf import render_certified_results_pdf

ITEMS = [
    {
        "id": "budget",
        "type": "general_vote",
        "title": "Approve the 2027 budget",
        "position": "budget",
        "vote_type": "approval",
        "eligible_voter_types": ["all"],
    },
    {
        "id": "bylaws",
        "type": "general_vote",
        "title": "Amend the bylaws",
        "position": "bylaws",
        "vote_type": "approval",
        "eligible_voter_types": ["all"],
    },
    {
        "id": "chief",
        "type": "officer_election",
        "title": "Election for Chief",
        "position": "Chief",
        "vote_type": "candidate_selection",
        "eligible_voter_types": ["all"],
    },
]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def item_ballot(db_session: AsyncSession):
    """An open item-only ballot (no ``positions``): budget 3-1, bylaws 1-2,
    and a 1-1 Chief race, with ``tie_policy = runoff``."""
    org_id, creator, election_id = _uid(), _uid(), _uid()
    now = datetime.now(timezone.utc)
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, 'Grouped FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"grp-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Sam', 'Secretary', :em, 'hashed', 'active')"
        ),
        {
            "id": creator,
            "org": org_id,
            "un": f"sec-{creator[:8]}",
            "em": f"sec-{creator[:8]}@t.com",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO elections (id, organization_id, title, election_type, "
            "positions, ballot_items, start_date, end_date, status, "
            "anonymous_voting, allow_write_ins, max_votes_per_position, "
            "voting_method, victory_condition, tie_policy, "
            "voter_anonymity_salt, quorum_type, created_by, email_sent, "
            "results_visible_immediately, enable_runoffs, runoff_type, "
            "max_runoff_rounds, is_runoff, runoff_round, created_at, "
            "updated_at) VALUES (:id, :org, 'Annual Meeting', 'general', "
            "NULL, :items, :start, :end, 'open', 1, 0, 1, 'simple_majority', "
            "'most_votes', 'runoff', :salt, 'none', :creator, 0, 0, 1, "
            "'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "items": json.dumps(ITEMS),
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": creator,
        },
    )
    tallies = {
        ("budget", "Approve"): 3,
        ("budget", "Deny"): 1,
        ("bylaws", "Approve"): 1,
        ("bylaws", "Deny"): 2,
        ("Chief", "Alex Able"): 1,
        ("Chief", "Blair Baker"): 1,
    }
    ids = {}
    for order, ((position, name), count) in enumerate(tallies.items()):
        candidate = Candidate(
            election_id=election_id,
            name=name,
            position=position,
            accepted=True,
            is_write_in=False,
            display_order=order,
        )
        db_session.add(candidate)
        await db_session.flush()
        ids[(position, name)] = candidate.id
        for _ in range(count):
            db_session.add(
                Vote(
                    election_id=election_id,
                    candidate_id=candidate.id,
                    position=position,
                    voter_hash=secrets.token_hex(32),
                    vote_dedup_hash=secrets.token_hex(32),
                )
            )
    await db_session.flush()
    return {"org_id": org_id, "election_id": election_id, "ids": ids}


async def _results(db_session, data):
    return await ElectionService(db_session).get_election_results(
        uuid.UUID(data["election_id"]),
        uuid.UUID(data["org_id"]),
        _internal_bypass_visibility=True,
    )


@pytest.mark.integration
class TestGroupedResults:
    async def test_each_item_is_its_own_contest_and_nothing_is_pooled(
        self, db_session: AsyncSession, item_ballot
    ):
        results = await _results(db_session, item_ballot)

        assert results.overall_results == []
        contests = {pr.ballot_item_id: pr for pr in results.results_by_position}
        assert set(contests) == {"budget", "bylaws", "chief"}
        assert contests["budget"].vote_type == "approval"
        assert contests["chief"].vote_type == "candidate_selection"
        assert contests["budget"].label == "Approve the 2027 budget"

        budget = {c.candidate_name: c for c in contests["budget"].candidates}
        assert budget["Approve"].vote_count == 3
        assert budget["Approve"].percentage == 75.0
        assert budget["Approve"].is_winner
        assert not budget["Deny"].is_winner
        bylaws = {c.candidate_name: c for c in contests["bylaws"].candidates}
        assert bylaws["Deny"].is_winner
        assert not bylaws["Approve"].is_winner
        assert contests["chief"].is_tie

    async def test_a_tied_race_on_an_item_ballot_gets_its_runoff(
        self, db_session: AsyncSession, item_ballot
    ):
        """The pooled list crowned the budget's Approve (3 votes), so an
        item-only ballot never ran off its tied race."""
        data = item_ballot
        election = (
            await db_session.execute(
                select(Election).where(Election.id == data["election_id"])
            )
        ).scalar_one()

        runoff = await ElectionService(db_session)._check_and_create_runoff(
            election, uuid.UUID(data["org_id"])
        )

        assert runoff is not None
        assert [i["id"] for i in runoff.ballot_items] == ["chief"]
        names = set(
            (
                await db_session.execute(
                    select(Candidate.name).where(Candidate.election_id == runoff.id)
                )
            )
            .scalars()
            .all()
        )
        assert names == {"Alex Able", "Blair Baker"}
        assert "tie between Alex Able and Blair Baker" in runoff.description

    async def test_a_decided_item_ballot_gets_no_runoff(
        self, db_session: AsyncSession, item_ballot
    ):
        data = item_ballot
        db_session.add(
            Vote(
                election_id=data["election_id"],
                candidate_id=data["ids"][("Chief", "Alex Able")],
                position="Chief",
                voter_hash=secrets.token_hex(32),
                vote_dedup_hash=secrets.token_hex(32),
            )
        )
        await db_session.flush()
        election = (
            await db_session.execute(
                select(Election).where(Election.id == data["election_id"])
            )
        ).scalar_one()

        runoff = await ElectionService(db_session)._check_and_create_runoff(
            election, uuid.UUID(data["org_id"])
        )
        assert runoff is None


@pytest.mark.unit
class TestCertifiedPdfPerContest:
    def _text(self, results: dict) -> str:
        buf = render_certified_results_pdf(
            {
                "election": {"title": "Annual Meeting", "tie_policy": "runoff"},
                "results": results,
                "stats": {},
                "batches": [],
                "integrity": {},
            },
            {"org_name": "W50-7 FD", "generated_at": ""},
        )
        return " ".join(p.extract_text() for p in PdfReader(buf).pages).replace(
            "\n", " "
        )

    def test_one_table_per_contest_and_the_tie_names_the_item(self):
        out = self._text(
            {
                "results_by_position": [
                    {
                        "position": "budget",
                        "label": "Approve the 2027 budget",
                        "candidates": [
                            {
                                "candidate_name": "Approve",
                                "vote_count": 3,
                                "percentage": 75.0,
                                "is_winner": True,
                            },
                            {
                                "candidate_name": "Deny",
                                "vote_count": 1,
                                "percentage": 25.0,
                            },
                        ],
                    },
                    {
                        "position": "chief",
                        "label": "Election for Chief",
                        "is_tie": True,
                        "candidates": [
                            {
                                "candidate_name": "Alex Able",
                                "vote_count": 1,
                                "percentage": 50.0,
                                "is_tied": True,
                            },
                            {
                                "candidate_name": "Blair Baker",
                                "vote_count": 1,
                                "percentage": 50.0,
                                "is_tied": True,
                            },
                        ],
                    },
                ],
                "overall_results": [],
            }
        )
        assert "Results — Approve the 2027 budget" in out
        assert "Results — Election for Chief" in out
        assert "UNRESOLVED TIE for Election for Chief" in out
        assert "Other candidates" not in out

    def test_candidates_outside_any_contest_get_their_own_table(self):
        out = self._text(
            {
                "results_by_position": [],
                "overall_results": [
                    {
                        "candidate_name": "Casey Cole",
                        "vote_count": 2,
                        "percentage": 100.0,
                        "is_winner": True,
                    }
                ],
            }
        )
        assert "Results — " not in out
        assert "Casey Cole" in out
