"""W50-38: a manager may accept for a nominee (labelled, notified), and the
slate freezes at Close Nominations.

Before: ``PATCH …/candidates/{id}`` let any manager set ``accepted`` with no
label and no word to the nominee, after the nominator had been told "Only the
nominee can respond"; and after Close Nominations members lost the tab while
the API still took accepts and declines, so a race silently lost a candidate.

The owner decided (2026-10-08): managers may accept on a nominee's behalf
before nominations close, with a persisted "accepted by manager" label
(``candidates.accepted_on_behalf_by`` / ``_at``, migration ``7adc810c57f9``)
and a notice to the nominee; Close Nominations freezes the slate
(``elections.nominations_closed_at``).
"""

import importlib.util
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import update_candidate
from app.models.election import Candidate
from app.models.user import User
from app.schemas.election import CandidateUpdate
from app.services.election_service import SLATE_FROZEN_MESSAGE, ElectionService
from tests.test_election_nominations import TestNominationSetup


async def _user(db: AsyncSession, user_id: str) -> User:
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one()


async def _candidate(db: AsyncSession, candidate_id: str) -> Candidate:
    return (
        await db.execute(select(Candidate).where(Candidate.id == candidate_id))
    ).scalar_one()


@pytest.mark.integration
class TestManagerAcceptAndFrozenSlate(TestNominationSetup):
    async def _pending(self, db: AsyncSession, setup) -> tuple:
        org_id, user1_id, user2_id = setup
        election_id = await self._insert_election(db, org_id, user1_id)
        svc = ElectionService(db)
        _opened, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        candidate, err = await svc.create_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            nominator_id=user1_id,
            position="Chief",
            nominee_user_id=user2_id,
        )
        assert err is None, err
        assert candidate.accepted is False
        return org_id, user1_id, user2_id, election_id, str(candidate.id)

    async def test_manager_accept_is_labelled_and_the_nominee_is_told(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, manager_id, nominee_id, election_id, cand_id = await self._pending(
            db_session, setup_org_and_users
        )
        with patch(
            "app.services.email_service.EmailService.send_email",
            new_callable=AsyncMock,
            return_value=(1, 0),
        ) as send:
            result = await update_candidate(
                election_id=uuid.UUID(election_id),
                candidate_id=uuid.UUID(cand_id),
                candidate_update=CandidateUpdate(accepted=True),
                db=db_session,
                current_user=await _user(db_session, manager_id),
            )
        assert result.accepted is True
        assert result.accepted_on_behalf_by == manager_id
        assert result.accepted_on_behalf_at is not None

        send.assert_awaited_once()
        kwargs = send.await_args.kwargs
        assert kwargs["to_emails"] == [(await _user(db_session, nominee_id)).email]
        assert "on your behalf" in kwargs["html_body"]

        # The nominee accepting in person removes the label.
        ok, err = await ElectionService(db_session).respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            candidate_id=uuid.UUID(cand_id),
            user_id=nominee_id,
            accept=True,
        )
        assert ok, err
        refreshed = await _candidate(db_session, cand_id)
        assert refreshed.accepted_on_behalf_by is None
        assert refreshed.accepted_on_behalf_at is None

    async def test_the_nominee_accepting_themselves_is_not_labelled(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        _org, _manager, nominee_id, election_id, cand_id = await self._pending(
            db_session, setup_org_and_users
        )
        # A nominee who also holds elections.manage accepting their own.
        result = await update_candidate(
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(cand_id),
            candidate_update=CandidateUpdate(accepted=True),
            db=db_session,
            current_user=await _user(db_session, nominee_id),
        )
        assert result.accepted is True
        assert result.accepted_on_behalf_by is None

    async def test_close_nominations_freezes_the_slate(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, manager_id, nominee_id, election_id, cand_id = await self._pending(
            db_session, setup_org_and_users
        )
        svc = ElectionService(db_session)
        closed, err = await svc.close_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        assert closed.nominations_closed_at is not None

        for accept in (True, False):
            ok, err = await svc.respond_to_nomination(
                election_id=uuid.UUID(election_id),
                organization_id=uuid.UUID(org_id),
                candidate_id=uuid.UUID(cand_id),
                user_id=nominee_id,
                accept=accept,
            )
            assert ok is False
            assert err == SLATE_FROZEN_MESSAGE

        with pytest.raises(HTTPException) as exc:
            await update_candidate(
                election_id=uuid.UUID(election_id),
                candidate_id=uuid.UUID(cand_id),
                candidate_update=CandidateUpdate(accepted=True),
                db=db_session,
                current_user=await _user(db_session, manager_id),
            )
        assert exc.value.status_code == 400
        assert exc.value.detail == SLATE_FROZEN_MESSAGE
        assert (await _candidate(db_session, cand_id)).accepted is False

        # A statement edit is not a slate change and still goes through.
        result = await update_candidate(
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(cand_id),
            candidate_update=CandidateUpdate(statement="Twenty years of service"),
            db=db_session,
            current_user=await _user(db_session, manager_id),
        )
        assert result.statement == "Twenty years of service"

    async def test_reopening_nominations_unfreezes(
        self, db_session: AsyncSession, setup_org_and_users
    ):
        org_id, _manager, nominee_id, election_id, cand_id = await self._pending(
            db_session, setup_org_and_users
        )
        svc = ElectionService(db_session)
        await svc.close_nominations(uuid.UUID(election_id), uuid.UUID(org_id))
        reopened, err = await svc.open_nominations(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        assert reopened.nominations_closed_at is None

        ok, err = await svc.respond_to_nomination(
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            candidate_id=uuid.UUID(cand_id),
            user_id=nominee_id,
            accept=True,
        )
        assert ok, err


# ── Migration ────────────────────────────────────────────────────────────

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
(MIGRATION_PATH,) = sorted(VERSIONS.glob("*_7adc810c57f9_*.py"))


def _migrate(engine, direction: str) -> None:
    spec = importlib.util.spec_from_file_location("accept_on_behalf", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, direction)()


def _columns(engine, table: str) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns(table)}


@pytest.mark.unit
class TestMigration:
    def test_adds_the_columns_idempotently_and_downgrades(self):
        engine = sa.create_engine("sqlite://")
        with engine.begin() as connection:
            connection.execute(sa.text("CREATE TABLE users (id TEXT PRIMARY KEY)"))
            connection.execute(sa.text("CREATE TABLE elections (id TEXT PRIMARY KEY)"))
            connection.execute(
                sa.text("CREATE TABLE candidates (id TEXT PRIMARY KEY, name TEXT)")
            )
        _migrate(engine, "upgrade")
        _migrate(engine, "upgrade")
        assert {"accepted_on_behalf_by", "accepted_on_behalf_at"} <= _columns(
            engine, "candidates"
        )
        assert "nominations_closed_at" in _columns(engine, "elections")
        _migrate(engine, "downgrade")
        _migrate(engine, "downgrade")
        assert _columns(engine, "candidates") == {"id", "name"}
        assert _columns(engine, "elections") == {"id"}

    def test_a_database_without_the_tables_is_skipped(self):
        engine = sa.create_engine("sqlite://")
        _migrate(engine, "upgrade")
        _migrate(engine, "downgrade")
