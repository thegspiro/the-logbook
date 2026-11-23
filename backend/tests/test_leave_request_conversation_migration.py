"""``e5a9c3d71b28`` adds the leave request conversation, with rows present.

Run for real against MySQL/MariaDB on uniquely prefixed scratch copies of the
tables ``c8d2f61a7e34`` builds (DDL cannot ride in a rolled-back transaction),
with a request and a vote already in them, because what matters is what
happens to those rows (CLAUDE.md pitfall #35). Pinned:

* the stored request reads as before, in round 1 with no question, proposal
  or extension, and the stored vote counts in round 1;
* the one-vote rule becomes one vote per approver per round: the same
  approver may vote again in round 2, but not twice in one round;
* the downgrade deletes votes from rounds before the request's current one
  (the narrower key could not hold them), restores the one-vote key, and
  drops what the upgrade added;
* a re-run of either step changes nothing.

The email template ENUM widening is not exercised here: it runs against the
real tables and is covered by ``test_database_schema``.
"""

import importlib.util
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings

pytestmark = pytest.mark.integration

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load(pattern: str, name: str):
    [path] = list(_VERSIONS.glob(pattern))
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = _load("*_c8d2f61a7e34_*.py", "_leave_requests_build")
CONVERSATION = _load("*_e5a9c3d71b28_*.py", "_leave_request_conversation")


def _run(engine, step) -> None:
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()


@pytest.fixture
def built(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for module in (BUILD, CONVERSATION):
        monkeypatch.setattr(module, "_TEMPLATE_COLUMNS", ())
        monkeypatch.setattr(module, "REQUESTS", f"{prefix}leave_requests")
        monkeypatch.setattr(module, "VOTES", f"{prefix}leave_request_votes")
    monkeypatch.setattr(BUILD, "SENDS", f"{prefix}leave_notice_sends")
    monkeypatch.setattr(CONVERSATION, "MESSAGES", f"{prefix}leave_request_messages")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    _run(engine, BUILD.upgrade)
    with engine.connect() as conn:
        # Placeholder parents: the rows here are about this table's columns,
        # not about the organization or members they point at.
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
        conn.exec_driver_sql(
            f"INSERT INTO {BUILD.REQUESTS} (id, organization_id, user_id, "
            "start_date, status, decision_rule) VALUES "
            "('r-1', 'org', 'member', '2027-03-01', 'pending', 'majority')"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {BUILD.VOTES} (id, organization_id, request_id, "
            "voter_id, vote) VALUES ('v-1', 'org', 'r-1', 'approver', 'approve')"
        )
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
        conn.commit()
    try:
        yield SimpleNamespace(engine=engine)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in (
                CONVERSATION.MESSAGES,
                BUILD.VOTES,
                BUILD.REQUESTS,
                BUILD.SENDS,
            ):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _vote(conn, vote_id: str, round_: int) -> None:
    conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
    conn.exec_driver_sql(
        f"INSERT INTO {BUILD.VOTES} (id, organization_id, request_id, voter_id, "
        "vote, round) VALUES (%s, 'org', 'r-1', 'approver', 'approve', %s)",
        (vote_id, round_),
    )
    conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")


def _columns(engine, table) -> set:
    with engine.connect() as conn:
        return {c["name"] for c in sa.inspect(conn).get_columns(table)}


class TestUpgradeWithRowsPresent:
    def test_the_stored_request_and_vote_are_in_round_one(self, built):
        for _ in range(2):
            _run(built.engine, CONVERSATION.upgrade)
        with built.engine.connect() as conn:
            request = conn.exec_driver_sql(
                f"SELECT start_date, status, vote_round, extends_leave_id, "
                f"info_requested_at, proposed_at FROM {BUILD.REQUESTS}"
            ).one()
            vote = conn.exec_driver_sql(f"SELECT vote, round FROM {BUILD.VOTES}").one()
        assert str(request[0]) == "2027-03-01"
        assert tuple(request[1:]) == ("pending", 1, None, None, None)
        assert tuple(vote) == ("approve", 1)
        assert sa.inspect(built.engine).has_table(CONVERSATION.MESSAGES)

    def test_one_vote_per_approver_per_round(self, built):
        _run(built.engine, CONVERSATION.upgrade)
        with built.engine.connect() as conn:
            _vote(conn, "v-2", 2)
            conn.commit()
            with pytest.raises(sa.exc.IntegrityError):
                _vote(conn, "v-3", 2)


class TestDowngrade:
    def test_earlier_rounds_go_and_the_one_vote_key_returns(self, built):
        _run(built.engine, CONVERSATION.upgrade)
        with built.engine.connect() as conn:
            _vote(conn, "v-2", 2)
            conn.exec_driver_sql(f"UPDATE {BUILD.REQUESTS} SET vote_round = 2")
            conn.commit()

        for _ in range(2):
            _run(built.engine, CONVERSATION.downgrade)

        with built.engine.connect() as conn:
            remaining = conn.exec_driver_sql(f"SELECT id FROM {BUILD.VOTES}").all()
        assert [r[0] for r in remaining] == ["v-2"]
        assert {"vote_round", "extends_leave_id", "proposed_at"}.isdisjoint(
            _columns(built.engine, BUILD.REQUESTS)
        )
        assert "round" not in _columns(built.engine, BUILD.VOTES)
        assert not sa.inspect(built.engine).has_table(CONVERSATION.MESSAGES)
        with built.engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            with pytest.raises(sa.exc.IntegrityError):
                conn.exec_driver_sql(
                    f"INSERT INTO {BUILD.VOTES} (id, organization_id, request_id, "
                    "voter_id, vote) VALUES ('v-4', 'org', 'r-1', 'approver', "
                    "'deny')"
                )
