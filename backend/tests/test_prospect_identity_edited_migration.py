"""Migration 809893462b67 stamps the applications an applicant already edited.

Run against throwaway tables in the suite's own database; the real tables are
never altered. The rows and their activity are inserted first, because the
backfill is the point: each application's history is replayed in order, so an
applicant's change to their email, name or birth date stamps it, and a later
coordinator correction of one of them leaves it clear (ADV2-10).
"""

import importlib.util
import json
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

pytestmark = [pytest.mark.integration]

_REVISION = "809893462b67"
_TABLE = "x_identity_prospects"
_LOG = "x_identity_activity"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("identity_edited", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop(conn):
    for table in (_LOG, _TABLE):
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


# prospect id -> its activity, oldest first: (action, details, created_at)
_HISTORY = {
    # The applicant changed their email: stamped with that submission's time.
    "edited": [
        ("follow_up_form_submitted", {"changed_fields": ["email", "phone"]}, 1),
    ],
    # Only a phone number changed: left alone.
    "phone-only": [
        ("follow_up_form_submitted", {"changed_fields": ["phone"]}, 1),
    ],
    # The applicant changed their name, then a coordinator corrected it.
    "corrected": [
        ("follow_up_form_submitted", {"changed_fields": ["last_name"]}, 1),
        ("prospect_updated", {"changes": {"last_name": {"from": "a", "to": "b"}}}, 2),
    ],
    # Corrected, then edited again: the later edit wins.
    "edited-again": [
        ("follow_up_form_submitted", {"changed_fields": ["email"]}, 1),
        ("prospect_updated", {"changes": {"email": {"changed": True}}}, 2),
        ("follow_up_form_submitted", {"changed_fields": ["date_of_birth"]}, 3),
    ],
    # A coordinator's unrelated edit does not clear an applicant's.
    "unrelated-staff-edit": [
        ("follow_up_form_submitted", {"changed_fields": ["first_name"]}, 1),
        ("prospect_updated", {"changes": {"phone": {"from": "1", "to": "2"}}}, 2),
    ],
    "untouched": [],
}


def _at(day: int) -> datetime:
    return datetime(2026, 10, day, 12, 0, 0)


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop(conn)
        conn.execute(text(f"CREATE TABLE {_TABLE} (id VARCHAR(36) PRIMARY KEY)"))
        conn.execute(
            text(
                f"CREATE TABLE {_LOG} (id VARCHAR(36) PRIMARY KEY, "
                "prospect_id VARCHAR(36) NOT NULL, action VARCHAR(100) NOT NULL, "
                "details JSON, created_at DATETIME)"
            )
        )
        n = 0
        for prospect_id, events in _HISTORY.items():
            conn.execute(
                text(f"INSERT INTO {_TABLE} (id) VALUES (:id)"), {"id": prospect_id}
            )
            for action, details, day in events:
                n += 1
                conn.execute(
                    text(
                        f"INSERT INTO {_LOG} (id, prospect_id, action, details, "
                        "created_at) VALUES (:id, :p, :a, :d, :c)"
                    ),
                    {
                        "id": f"log-{n:03d}",
                        "p": prospect_id,
                        "a": action,
                        "d": json.dumps(details),
                        "c": _at(day),
                    },
                )
    yield engine
    with engine.begin() as conn:
        _drop(conn)
    engine.dispose()


def _run(engine, step: str):
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module.TABLE = _TABLE
    module.LOG = _LOG
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _stamps(engine) -> dict:
    with engine.connect() as conn:
        return {
            row_id: stamp
            for row_id, stamp in conn.execute(
                text(f"SELECT id, identity_edited_by_applicant_at FROM {_TABLE}")
            )
        }


def _columns(engine) -> set:
    return {c["name"] for c in sa.inspect(engine).get_columns(_TABLE)}


class TestIdentityEditedMigration:
    def test_existing_applications_are_stamped_from_their_history(self, scratch_engine):
        _run(scratch_engine, "upgrade")

        assert _stamps(scratch_engine) == {
            "edited": _at(1),
            "phone-only": None,
            "corrected": None,
            "edited-again": _at(3),
            "unrelated-staff-edit": _at(1),
            "untouched": None,
        }

    def test_a_rerun_does_not_restamp_a_cleared_row(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        with scratch_engine.begin() as conn:
            conn.execute(
                text(
                    f"UPDATE {_TABLE} SET identity_edited_by_applicant_at = NULL "
                    "WHERE id = 'edited'"
                )
            )

        _run(scratch_engine, "upgrade")

        assert _stamps(scratch_engine)["edited"] is None

    def test_the_downgrade_drops_the_column(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        _run(scratch_engine, "downgrade")  # a re-run changes nothing

        assert "identity_edited_by_applicant_at" not in _columns(scratch_engine)
        assert len(_stamps_ids(scratch_engine)) == len(_HISTORY)

    def test_a_missing_table_is_skipped(self, scratch_engine):
        module = _load_migration()
        from alembic.operations import Operations
        from alembic.runtime.migration import MigrationContext

        module.TABLE = "x_identity_never_created"
        module.LOG = _LOG
        with scratch_engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                module.upgrade()
                module.downgrade()


def _stamps_ids(engine) -> list:
    with engine.connect() as conn:
        return [row[0] for row in conn.execute(text(f"SELECT id FROM {_TABLE}"))]
