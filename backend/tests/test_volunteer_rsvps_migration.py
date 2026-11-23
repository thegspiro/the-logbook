"""``c7e1a94d2f58`` marks volunteer RSVPs so they take no attendee seat.

Run for real against MySQL/MariaDB on uniquely named scratch tables, as the
other migration tests here do (DDL commits implicitly). Pinned:

* an empty database is a no-op both ways (pitfall #26);
* over rows (pitfall #35), existing RSVPs read as audience, and only a going
  RSVP whose member holds a live seat on the sheet staffing that event — its
  own, or its request's — is marked; a cancelled seat, a member not going,
  and another department's seat are not;
* a re-run changes nothing, and the downgrade drops the column.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.core.config import settings
from app.models.event import EventRSVP

pytestmark = pytest.mark.integration

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20261121_1000_c7e1a94d2f58_volunteer_rsvps_are_crew.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_volunteer_rsvps", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()


@pytest.mark.unit
def test_the_model_declares_the_column():
    column = EventRSVP.__table__.c[MIGRATION.COLUMN]
    assert MIGRATION.TABLE == EventRSVP.__table__.name
    assert isinstance(column.type, sa.Boolean)
    assert column.nullable is False


@pytest.fixture
def scratch(monkeypatch):
    suffix = uuid.uuid4().hex[:6]
    names = {
        "TABLE": f"v{suffix}_event_rsvps",
        "EVENTS": f"v{suffix}_events",
        "ASSIGNMENTS": f"v{suffix}_shift_assignments",
        "REQUESTS": f"v{suffix}_event_requests",
    }
    for attr, name in names.items():
        monkeypatch.setattr(MIGRATION, attr, name)
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield engine, names
    finally:
        with engine.connect() as conn:
            for name in names.values():
                conn.exec_driver_sql(f"DROP TABLE IF EXISTS `{name}`")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _build(engine, names) -> None:
    """The tables as an installation has them before this revision, with rows."""
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"CREATE TABLE `{names['EVENTS']}` (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, "
            "staffing_shift_id VARCHAR(36) NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{names['EVENTS']}` VALUES "
            "('own', 'org', 'own-sheet'), ('from-request', 'org', NULL)"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE `{names['REQUESTS']}` (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, event_id VARCHAR(36) NULL, "
            "staffing_shift_id VARCHAR(36) NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{names['REQUESTS']}` VALUES "
            "('req', 'org', 'from-request', 'request-sheet')"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE `{names['ASSIGNMENTS']}` (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, shift_id VARCHAR(36) NOT NULL, "
            "user_id VARCHAR(36) NOT NULL, "
            "assignment_status VARCHAR(20) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{names['ASSIGNMENTS']}` VALUES "
            "('a1', 'org', 'own-sheet', 'crew', 'confirmed'), "
            "('a2', 'org', 'own-sheet', 'dropped', 'cancelled'), "
            "('a3', 'org', 'own-sheet', 'declined', 'assigned'), "
            "('a4', 'org', 'request-sheet', 'request-crew', 'assigned'), "
            "('a5', 'elsewhere', 'own-sheet', 'stranger', 'assigned')"
        )
        conn.exec_driver_sql(
            f"CREATE TABLE `{names['TABLE']}` (id VARCHAR(36) PRIMARY KEY, "
            "organization_id VARCHAR(36) NOT NULL, event_id VARCHAR(36) NOT NULL, "
            "user_id VARCHAR(36) NOT NULL, "
            "status VARCHAR(20) NOT NULL) ENGINE=InnoDB"
        )
        conn.exec_driver_sql(
            f"INSERT INTO `{names['TABLE']}` VALUES "
            "('crew', 'org', 'own', 'crew', 'going'), "
            "('dropped', 'org', 'own', 'dropped', 'going'), "
            "('declined', 'org', 'own', 'declined', 'not_going'), "
            "('audience', 'org', 'own', 'audience', 'going'), "
            "('request-crew', 'org', 'from-request', 'request-crew', 'going'), "
            "('stranger', 'org', 'own', 'stranger', 'going')"
        )
        conn.commit()


def _marked(engine, table) -> dict:
    with engine.connect() as conn:
        result = conn.exec_driver_sql(f"SELECT id, is_volunteer FROM `{table}`")
        return {row.id: bool(row.is_volunteer) for row in result}


def test_an_empty_database_is_a_no_op_both_ways(scratch):
    engine, _names = scratch
    _run(engine, MIGRATION.upgrade)
    _run(engine, MIGRATION.downgrade)


def test_only_live_seats_on_the_events_sheet_are_marked(scratch):
    engine, names = scratch
    _build(engine, names)

    _run(engine, MIGRATION.upgrade)

    assert _marked(engine, names["TABLE"]) == {
        "crew": True,
        "dropped": False,
        "declined": False,
        "audience": False,
        "request-crew": True,
        "stranger": False,
    }


def test_a_rerun_changes_nothing_and_the_downgrade_drops_it(scratch):
    engine, names = scratch
    _build(engine, names)
    _run(engine, MIGRATION.upgrade)
    first = _marked(engine, names["TABLE"])

    _run(engine, MIGRATION.upgrade)
    assert _marked(engine, names["TABLE"]) == first

    _run(engine, MIGRATION.downgrade)
    columns = {c["name"] for c in sa.inspect(engine).get_columns(names["TABLE"])}
    assert MIGRATION.COLUMN not in columns
