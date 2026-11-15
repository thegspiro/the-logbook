"""``c4e81b7a2d95``: election and minutes notices become template types.

Run for real against MySQL on uniquely prefixed scratch tables (DDL cannot ride
in a rolled-back transaction; the pattern of
``test_attendance_waiver_email_migration.py``). The tables hold rows before
upgrading, because CI's empty database cannot show what an existing
department's rows do (CLAUDE.md pitfall #35). Pinned:

* existing template and scheduled-email rows keep their type through the
  upgrade;
* every new type can be stored afterwards, in both tables;
* a second upgrade changes nothing;
* the downgrade deletes only the new types' rows and leaves every other row;
* each table is skipped when it is not there (pitfall #26).
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
from app.models.email_template import EmailTemplate, EmailTemplateType, ScheduledEmail

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_c4e81b7a2d95_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_election_minutes", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()

_NEW = set(MIGRATION._NEW_TEMPLATE_TYPES)


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_names(self):
        assert MIGRATION.TEMPLATES == EmailTemplate.__tablename__
        assert MIGRATION.SCHEDULED == ScheduledEmail.__tablename__

    def test_the_widened_enum_is_in_the_models(self):
        models = {t.value for t in EmailTemplateType}
        assert set(MIGRATION.ALL_TYPES) <= models
        assert _NEW <= set(MIGRATION.ALL_TYPES)
        assert set(MIGRATION._EXISTING_TEMPLATE_TYPES) <= set(MIGRATION.ALL_TYPES)
        assert len(MIGRATION.ALL_TYPES) == len(set(MIGRATION.ALL_TYPES))
        assert MIGRATION.ALL_TYPES[-1] == "custom"

    def test_it_adds_the_ten_notices_and_nothing_already_there(self):
        assert _NEW == {
            "election_nominations_open",
            "election_nominated",
            "election_nomination_accepted_for_you",
            "election_proxy_authorized",
            "pre_meeting_package",
            "minutes_circulated",
            "minutes_action_items",
            "minutes_action_item_reminder",
            "minutes_open_items_digest",
            "meeting_action_item_reminder",
        }
        assert not _NEW & set(MIGRATION._EXISTING_TEMPLATE_TYPES)


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in ("TEMPLATES", "SCHEDULED"):
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        yield SimpleNamespace(engine=engine)
    finally:
        with engine.connect() as conn:
            for attr in ("TEMPLATES", "SCHEDULED"):
                conn.exec_driver_sql(
                    f"DROP TABLE IF EXISTS `{getattr(MIGRATION, attr)}`"
                )
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _enum_sql(values) -> str:
    return "ENUM(" + ", ".join(f"'{v}'" for v in values) + ")"


def _build(engine, tables=("TEMPLATES", "SCHEDULED")) -> None:
    """The tables as the previous revision leaves them, with rows in them."""
    old = _enum_sql(MIGRATION._EXISTING_TEMPLATE_TYPES)
    with engine.connect() as conn:
        for attr in tables:
            name = getattr(MIGRATION, attr)
            conn.exec_driver_sql(
                f"CREATE TABLE `{name}` (id VARCHAR(36) PRIMARY KEY, "
                f"template_type {old} NOT NULL)"
            )
            conn.exec_driver_sql(
                f"INSERT INTO `{name}` VALUES ('a', 'ballot_notification'), "
                "('b', 'meeting_waiver_decided'), ('c', 'custom')"
            )
        conn.commit()


def _rows(engine, attr):
    with engine.connect() as conn:
        return dict(
            conn.exec_driver_sql(
                f"SELECT id, template_type FROM `{getattr(MIGRATION, attr)}` "
                "ORDER BY id"
            ).all()
        )


def _insert(engine, attr, row_id, value) -> None:
    with engine.connect() as conn:
        conn.exec_driver_sql(
            f"INSERT INTO `{getattr(MIGRATION, attr)}` VALUES (%s, %s)",
            (row_id, value),
        )
        conn.commit()


_EXISTING_ROWS = {
    "a": "ballot_notification",
    "b": "meeting_waiver_decided",
    "c": "custom",
}


@pytest.mark.integration
class TestAgainstRowsThatExist:
    def test_existing_rows_keep_their_type_and_new_types_can_be_stored(self, scratch):
        _build(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        for attr in ("TEMPLATES", "SCHEDULED"):
            assert _rows(scratch.engine, attr) == _EXISTING_ROWS
            for i, value in enumerate(sorted(_NEW)):
                _insert(scratch.engine, attr, f"n{i}", value)
            assert set(_rows(scratch.engine, attr).values()) >= _NEW

    def test_a_new_type_is_refused_before_the_upgrade(self, scratch):
        """Proves the inserts above are evidence: the old column refuses them."""
        _build(scratch.engine)
        with pytest.raises(sa.exc.DBAPIError):
            _insert(scratch.engine, "TEMPLATES", "n", "minutes_circulated")

    def test_a_second_upgrade_changes_nothing(self, scratch):
        _build(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        _insert(scratch.engine, "TEMPLATES", "n", "pre_meeting_package")
        _run(scratch.engine, MIGRATION.upgrade)
        assert _rows(scratch.engine, "TEMPLATES") == {
            **_EXISTING_ROWS,
            "n": "pre_meeting_package",
        }

    def test_the_downgrade_removes_only_the_new_types(self, scratch):
        _build(scratch.engine)
        _run(scratch.engine, MIGRATION.upgrade)
        for attr in ("TEMPLATES", "SCHEDULED"):
            _insert(scratch.engine, attr, "n", "election_nominated")
        _run(scratch.engine, MIGRATION.downgrade)
        for attr in ("TEMPLATES", "SCHEDULED"):
            assert _rows(scratch.engine, attr) == _EXISTING_ROWS
        with pytest.raises(sa.exc.DBAPIError):
            _insert(scratch.engine, "TEMPLATES", "m", "election_nominated")

    def test_a_missing_table_is_skipped(self, scratch):
        _build(scratch.engine, tables=("TEMPLATES",))
        _run(scratch.engine, MIGRATION.upgrade)
        _insert(scratch.engine, "TEMPLATES", "n", "minutes_open_items_digest")
        _run(scratch.engine, MIGRATION.downgrade)
        assert _rows(scratch.engine, "TEMPLATES") == _EXISTING_ROWS
