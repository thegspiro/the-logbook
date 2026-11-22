"""``c4e7a9d2f1b8`` repairs an installation that was stamped past ``5a41041e328b``.

Such an installation's startup skipped the migration and its column repair then
added ``source`` from the model, leaving ``contact_email`` NOT NULL, so a
request entered with only a phone number failed with MySQL 1048. Run for real
on a uniquely named scratch table, as
``test_staff_entered_event_requests_migration.py`` does (DDL commits implicitly).
Pinned:

* that repaired state, with rows (pitfall #35): the email becomes optional,
  every row is kept, and a phone-only request can then be stored;
* a table that never got ``source`` gets it, reading ``web``;
* a table ``5a41041e328b`` already upgraded is left exactly as it was;
* an empty database is a no-op (pitfall #26);
* it is the single head.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

from app.core.config import settings

_BACKEND = Path(__file__).resolve().parents[1]
_PATH = (
    _BACKEND
    / "alembic"
    / "versions"
    / "20261122_1330_c4e7a9d2f1b8_reassert_optional_event_request_email.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_reassert_email", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_it_targets_event_requests():
    assert MIGRATION.TABLE == "event_requests"


@pytest.mark.unit
def test_the_chain_has_one_head_again():
    config = Config(str(_BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(_BACKEND / "alembic"))
    script = ScriptDirectory.from_config(config)
    heads = script.get_heads()
    # One head, with this revision on its line: naming the head itself would
    # fail for every migration added after this one, which is not a fork.
    assert len(heads) == 1
    line = {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert "c4e7a9d2f1b8" in line


@pytest.fixture
def scratch(monkeypatch):
    table = f"r{uuid.uuid4().hex[:6]}_event_requests"
    monkeypatch.setattr(MIGRATION, "TABLE", table)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield engine, table
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{table}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _columns(engine, table: str) -> dict:
    with engine.connect() as conn:
        return {c["name"]: c["nullable"] for c in sa.inspect(conn).get_columns(table)}


def _rows(engine, table: str) -> dict:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(
            f"SELECT id, contact_name, contact_email, source FROM `{table}`"
        )
        return {row[0]: tuple(row[1:]) for row in result}


def _build(engine, table: str, email_nullable: bool, with_source: bool) -> None:
    email = "TEXT NULL" if email_nullable else "TEXT NOT NULL"
    source = ", source VARCHAR(20) NOT NULL DEFAULT 'web'" if with_source else ""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE `{table}` (id VARCHAR(36) PRIMARY KEY, "
            "contact_name VARCHAR(255) NOT NULL, "
            f"contact_email {email}{source}) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{table}` (id, contact_name, contact_email) VALUES "
            "('req-1', 'Pat Rivera', 'ciphertext-1'), "
            "('req-2', 'Dana Whitfield', 'ciphertext-2')"
        )
        conn.commit()


def _insert_phone_only(engine, table: str) -> None:
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"INSERT INTO `{table}` (id, contact_name, contact_email, source) "
            "VALUES ('phone-1', 'Stanley Test', NULL, 'other')"
        )
        conn.commit()


_BEFORE = {
    "req-1": ("Pat Rivera", "ciphertext-1", "web"),
    "req-2": ("Dana Whitfield", "ciphertext-2", "web"),
}


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_a_skipped_upgrade_with_a_repaired_source_is_fixed(self, scratch):
        engine, table = scratch
        _build(engine, table, email_nullable=False, with_source=True)
        with pytest.raises(sa.exc.IntegrityError, match="1048"):
            _insert_phone_only(engine, table)

        _run(engine, MIGRATION.upgrade)
        assert _columns(engine, table)["contact_email"] is True
        assert _rows(engine, table) == _BEFORE

        _insert_phone_only(engine, table)
        assert _rows(engine, table)["phone-1"] == ("Stanley Test", None, "other")

    def test_a_table_without_source_gets_it(self, scratch):
        engine, table = scratch
        _build(engine, table, email_nullable=False, with_source=False)
        _run(engine, MIGRATION.upgrade)
        columns = _columns(engine, table)
        assert columns["contact_email"] is True
        assert columns["source"] is False
        assert _rows(engine, table) == _BEFORE

    def test_an_already_upgraded_table_is_left_alone(self, scratch):
        engine, table = scratch
        _build(engine, table, email_nullable=True, with_source=True)
        _insert_phone_only(engine, table)
        before = _rows(engine, table)
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.upgrade)
        assert _rows(engine, table) == before
        assert _columns(engine, table)["contact_email"] is True

    def test_an_empty_database_is_a_no_op(self, scratch):
        engine, table = scratch
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        with engine.connect() as conn:
            assert table not in sa.inspect(conn).get_table_names()
