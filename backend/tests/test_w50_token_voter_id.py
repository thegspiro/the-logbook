"""W50-3: a named election's who-voted roster names its link voters.

A link (token) vote stored only the voter hash, so once the election closed
and its salt was destroyed, nothing could say which member had cast it: the
roster of who voted lost every link voter. The owner decided (2026-10-08) to
add a nullable ``voting_tokens.user_id`` set at issue (migration
``edb445ae5806``), and for tokens issued before it, to resolve the voter by
matching the hash against the roster at submit time. Both token routes now
store ``voter_id`` on a named election's link votes. An anonymous election
records neither — that would undo the anonymity the salt provides.
"""

import importlib.util
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Election, Vote, VotingToken
from app.services.election_service import ElectionService, position_item_id
from tests.test_election_voting_flow import TestElectionSetup

CHIEF_ITEM = position_item_id("Chief")


async def _anonymous(db: AsyncSession, data: dict, value: bool) -> None:
    await db.execute(
        text("UPDATE elections SET anonymous_voting = :v WHERE id = :id"),
        {"v": value, "id": data["election_id"]},
    )
    await db.flush()


async def _token(db: AsyncSession, data: dict, user_key: str, *, record: bool):
    row, raw = await ElectionService(db)._generate_voting_token(
        user_id=uuid.UUID(data[user_key]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
        record_user_id=record,
    )
    await db.flush()
    return row, raw


async def _link_votes(db: AsyncSession, election_id: str):
    return list(
        (await db.execute(select(Vote).where(Vote.election_id == election_id)))
        .scalars()
        .all()
    )


@pytest.mark.integration
class TestTokenVoterId(TestElectionSetup):
    async def test_named_election_token_records_the_recipient_and_the_vote(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _anonymous(db_session, data, False)
        row, raw = await _token(db_session, data, "user3_id", record=True)
        assert row.user_id == data["user3_id"]

        vote, err = await ElectionService(db_session).cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
        )
        assert err is None, err
        assert vote.voter_id == data["user3_id"]

        # Close destroys the salt; the roster still names the link voter.
        election = (
            await db_session.execute(
                select(Election).where(Election.id == data["election_id"])
            )
        ).scalar_one()
        election.voter_anonymity_salt = None
        await db_session.flush()
        roster = await ElectionService(db_session).get_eligibility_roster(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        voted = {m["user_id"] for m in roster["roster"] if m["has_voted"]}
        assert voted == {data["user3_id"]}

    async def test_a_token_issued_before_the_column_is_resolved_by_hash(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _anonymous(db_session, data, False)
        row, raw = await _token(db_session, data, "user2_id", record=False)
        assert row.user_id is None

        result, err = await ElectionService(db_session).submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": CHIEF_ITEM, "choice": data["candidate_a_id"]}],
        )
        assert err is None, err
        assert result["votes_cast"] == 1
        [vote] = await _link_votes(db_session, data["election_id"])
        assert vote.voter_id == data["user2_id"]

    async def test_anonymous_election_records_nobody(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _anonymous(db_session, data, True)
        _row, raw = await _token(db_session, data, "user3_id", record=False)

        result, err = await ElectionService(db_session).submit_ballot_with_token(
            token=raw,
            votes=[{"ballot_item_id": CHIEF_ITEM, "choice": data["candidate_a_id"]}],
        )
        assert err is None, err
        [vote] = await _link_votes(db_session, data["election_id"])
        assert vote.voter_id is None

    async def test_send_ballot_emails_sets_user_id_on_named_elections_only(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election

        async def _accept(batch):
            return [True] * len(batch)

        async def _token_ids() -> set:
            rows = await db_session.execute(
                select(VotingToken.id).where(
                    VotingToken.election_id == data["election_id"]
                )
            )
            return {row[0] for row in rows.all()}

        for anonymous in (False, True):
            await _anonymous(db_session, data, anonymous)
            # Both sends land within the same second, so created_at cannot
            # tell the new token from the old one; diff the ids instead.
            before = await _token_ids()
            with patch(
                "app.services.email_service.EmailService.send_batch",
                new=AsyncMock(side_effect=_accept),
            ):
                sent, failed, *_rest = await ElectionService(
                    db_session
                ).send_ballot_emails(
                    election_id=uuid.UUID(data["election_id"]),
                    organization_id=uuid.UUID(data["org_id"]),
                    recipient_user_ids=[uuid.UUID(data["user3_id"])],
                    base_ballot_url="https://fd.example/ballot",
                )
            assert (sent, failed) == (1, 0)
            (new_id,) = (await _token_ids()) - before
            newest = await db_session.get(VotingToken, new_id)
            if anonymous:
                assert newest.user_id is None
            else:
                assert newest.user_id == data["user3_id"]


# ── Migration ────────────────────────────────────────────────────────────

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
(MIGRATION_PATH,) = sorted(VERSIONS.glob("*_edb445ae5806_*.py"))


def _migrate(engine, direction: str) -> None:
    spec = importlib.util.spec_from_file_location("token_user_id", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, direction)()


def _columns(engine) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns("voting_tokens")}


@pytest.mark.unit
class TestMigration:
    def test_adds_the_column_idempotently_and_downgrades(self):
        engine = sa.create_engine("sqlite://")
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE users (id TEXT PRIMARY KEY)"))
            connection.execute(
                sa.text(
                    "CREATE TABLE voting_tokens (id TEXT PRIMARY KEY, voter_hash TEXT)"
                )
            )
            connection.execute(sa.text("INSERT INTO voting_tokens VALUES ('t1', 'h')"))
        _migrate(engine, "upgrade")
        _migrate(engine, "upgrade")
        assert "user_id" in _columns(engine)
        with engine.connect() as connection:
            assert (
                connection.execute(
                    sa.text("SELECT user_id FROM voting_tokens")
                ).scalar_one()
                is None
            )
        _migrate(engine, "downgrade")
        _migrate(engine, "downgrade")
        assert "user_id" not in _columns(engine)

    def test_a_database_without_the_table_is_skipped(self):
        engine = sa.create_engine("sqlite://")
        _migrate(engine, "upgrade")
        _migrate(engine, "downgrade")
