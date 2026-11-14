"""Migration 81b38694152f: legal-document revert rows and edit attribution.

Run with rows already in the table (CLAUDE.md Pitfall #35): a draft, a
published revision and an archived one, in the pre-migration shape. CI's
database user may not CREATE DATABASE, so the migration runs against a
throwaway copy of the table under a prefix in the suite's own database; the
suite's real table is never altered.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "81b38694152f"
_TABLE = "legalrevmig_legal_document_revisions"
_FK = "fk_legalrevmig_edited_by_users"

_ROWS = [
    ("r-draft", "draft"),
    ("r-live", "published"),
    ("r-old", "archived"),
]


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("legal_revert_edit", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    yield engine
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {_TABLE}"))
    engine.dispose()


def _make_table(engine):
    # The columns the pre-migration rows carry that matter here.
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY, "
                "status VARCHAR(16) NOT NULL, body TEXT NOT NULL, "
                "change_note TEXT NOT NULL)"
            )
        )
        for row_id, status in _ROWS:
            conn.execute(
                text(f"INSERT INTO {_TABLE} VALUES (:id, :status, 'Wording.', 'Why.')"),
                {"id": row_id, "status": status},
            )


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module._TABLE = _TABLE
    module._EDITED_BY_FK = _FK
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _columns(engine) -> set[str]:
    return {c["name"] for c in sa.inspect(engine).get_columns(_TABLE)}


def test_existing_rows_are_neither_reverts_nor_attributed_edits(scratch_engine):
    _make_table(scratch_engine)

    _run(scratch_engine, "upgrade")

    with scratch_engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT id, status, body, reverts_to_default, edited_by, edited_at "
                f"FROM {_TABLE} ORDER BY id"
            )
        ).all()
    assert [(r.id, r.status, r.body) for r in rows] == sorted(
        (row_id, status, "Wording.") for row_id, status in _ROWS
    )
    assert all(r.reverts_to_default == 0 for r in rows)
    assert all(r.edited_by is None and r.edited_at is None for r in rows)
    fks = sa.inspect(scratch_engine).get_foreign_keys(_TABLE)
    assert [
        (fk["constrained_columns"], fk["options"].get("ondelete")) for fk in fks
    ] == [(["edited_by"], "SET NULL")]


def test_upgrade_twice_is_a_no_op(scratch_engine):
    _make_table(scratch_engine)
    _run(scratch_engine, "upgrade")
    _run(scratch_engine, "upgrade")
    assert {"reverts_to_default", "edited_by", "edited_at"} <= _columns(scratch_engine)


def test_downgrade_removes_the_columns_and_only_the_revert_rows(scratch_engine):
    _make_table(scratch_engine)
    _run(scratch_engine, "upgrade")
    with scratch_engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_TABLE} (id, status, body, change_note, "
                "reverts_to_default) VALUES ('r-revert', 'archived', '', 'x', 1)"
            )
        )

    _run(scratch_engine, "downgrade")

    assert _columns(scratch_engine) == {"id", "status", "body", "change_note"}
    with scratch_engine.connect() as conn:
        ids = conn.execute(text(f"SELECT id FROM {_TABLE} ORDER BY id")).scalars().all()
    assert ids == sorted(row_id for row_id, _ in _ROWS)


def test_a_database_without_the_table_is_skipped(scratch_engine):
    # The table is created by an earlier, guarded migration; this one must
    # not die on a database where it is absent.
    _run(scratch_engine, "upgrade")
    assert _TABLE not in sa.inspect(scratch_engine).get_table_names()
