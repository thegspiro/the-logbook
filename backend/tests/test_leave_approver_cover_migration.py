"""``a9763f96e072`` adds Chief routing, vote seats and approver cover, with rows.

Run for real against MySQL/MariaDB on uniquely prefixed scratch copies of the
leave request tables, built by the revisions that made them, with a request
and two votes in two rounds already stored, because what matters is what
happens to those rows (CLAUDE.md pitfall #35). Pinned:

* the stored request keeps today's routing (``routed_to_chief`` 0), and each
  stored vote's seat is its own voter, with no ``on_behalf_of``;
* one vote per seat per round: a stand-in's vote for an approver's seat is
  refused once that approver's own vote fills it, and accepted in a round the
  seat is open;
* the downgrade deletes the votes a stand-in cast for someone else, restores
  the per-voter key and drops what the upgrade added;
* a re-run of either step changes nothing.
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


BUILD = _load("*_c8d2f61a7e34_*.py", "_cover_leave_requests_build")
CONVERSATION = _load("*_e5a9c3d71b28_*.py", "_cover_leave_request_conversation")
COVER = _load("*_a9763f96e072_*.py", "_leave_approver_cover")


def _run(engine, step) -> None:
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()


@pytest.fixture
def built(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for module in (BUILD, CONVERSATION, COVER):
        monkeypatch.setattr(module, "REQUESTS", f"{prefix}leave_requests")
        monkeypatch.setattr(module, "VOTES", f"{prefix}leave_request_votes")
    for module in (BUILD, CONVERSATION):
        monkeypatch.setattr(module, "_TEMPLATE_COLUMNS", ())
    monkeypatch.setattr(BUILD, "SENDS", f"{prefix}leave_notice_sends")
    monkeypatch.setattr(CONVERSATION, "MESSAGES", f"{prefix}leave_request_messages")
    monkeypatch.setattr(COVER, "COVERS", f"{prefix}leave_approver_covers")
    # A foreign key's name is unique across the database, and the real votes
    # table already carries this one.
    monkeypatch.setattr(COVER, "ON_BEHALF_FK", f"fk_{prefix}votes_on_behalf_of")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    _run(engine, BUILD.upgrade)
    _run(engine, CONVERSATION.upgrade)
    with engine.connect() as conn:
        # Placeholder parents: the rows here are about these tables' columns,
        # not about the organization or members they point at.
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
        conn.exec_driver_sql(
            f"INSERT INTO {COVER.REQUESTS} (id, organization_id, user_id, "
            "start_date, status, decision_rule, vote_round) VALUES "
            "('r-1', 'org', 'member', '2027-03-01', 'pending', 'all', 2)"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {COVER.VOTES} (id, organization_id, request_id, "
            "voter_id, vote, round) VALUES "
            "('v-1', 'org', 'r-1', 'approver', 'approve', 1), "
            "('v-2', 'org', 'r-1', 'approver', 'deny', 2)"
        )
        conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
        conn.commit()
    try:
        yield SimpleNamespace(engine=engine)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for table in (
                COVER.COVERS,
                CONVERSATION.MESSAGES,
                COVER.VOTES,
                COVER.REQUESTS,
                BUILD.SENDS,
            ):
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _seat_vote(conn, vote_id: str, voter: str, seat: str, round_: int) -> None:
    conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
    conn.exec_driver_sql(
        f"INSERT INTO {COVER.VOTES} (id, organization_id, request_id, voter_id, "
        "seat_id, on_behalf_of, vote, round) "
        "VALUES (%s, 'org', 'r-1', %s, %s, %s, 'approve', %s)",
        (vote_id, voter, seat, seat if seat != voter else None, round_),
    )
    conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")


def _columns(engine, table) -> set:
    with engine.connect() as conn:
        return {c["name"] for c in sa.inspect(conn).get_columns(table)}


class TestUpgradeWithRowsPresent:
    def test_stored_rows_keep_todays_meaning(self, built):
        for _ in range(2):
            _run(built.engine, COVER.upgrade)
        with built.engine.connect() as conn:
            routed = conn.exec_driver_sql(
                f"SELECT routed_to_chief FROM {COVER.REQUESTS}"
            ).scalar_one()
            votes = conn.exec_driver_sql(
                f"SELECT id, voter_id, seat_id, on_behalf_of FROM {COVER.VOTES} "
                "ORDER BY id"
            ).all()
        assert routed == 0
        assert [tuple(v) for v in votes] == [
            ("v-1", "approver", "approver", None),
            ("v-2", "approver", "approver", None),
        ]
        assert sa.inspect(built.engine).has_table(COVER.COVERS)

    def test_one_vote_per_seat_per_round(self, built):
        _run(built.engine, COVER.upgrade)
        with built.engine.connect() as conn:
            # The approver's own vote fills their seat in round 2, so a
            # stand-in cannot fill it again ...
            with pytest.raises(sa.exc.IntegrityError):
                _seat_vote(conn, "v-3", "stand-in", "approver", 2)
            conn.rollback()
            # ... but can in a round where it is open, and can fill their own
            # seat in the same round.
            _seat_vote(conn, "v-4", "stand-in", "approver", 3)
            _seat_vote(conn, "v-5", "stand-in", "stand-in", 3)
            conn.commit()


class TestDowngrade:
    def test_drops_stand_in_votes_and_restores_the_voter_key(self, built):
        _run(built.engine, COVER.upgrade)
        with built.engine.connect() as conn:
            _seat_vote(conn, "v-4", "stand-in", "approver", 3)
            _seat_vote(conn, "v-5", "stand-in", "stand-in", 3)
            conn.commit()
        for _ in range(2):
            _run(built.engine, COVER.downgrade)
        with built.engine.connect() as conn:
            ids = [
                r[0]
                for r in conn.exec_driver_sql(
                    f"SELECT id FROM {COVER.VOTES} ORDER BY id"
                ).all()
            ]
        assert ids == ["v-1", "v-2", "v-5"]
        assert {"seat_id", "on_behalf_of"}.isdisjoint(
            _columns(built.engine, COVER.VOTES)
        )
        assert "routed_to_chief" not in _columns(built.engine, COVER.REQUESTS)
        assert not sa.inspect(built.engine).has_table(COVER.COVERS)
        uniques = {
            u["name"]
            for u in sa.inspect(built.engine).get_unique_constraints(COVER.VOTES)
        }
        assert COVER.OLD_UNIQUE in uniques
        assert COVER.NEW_UNIQUE not in uniques
