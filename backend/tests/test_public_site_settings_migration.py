"""``7c3a91e5b2d4`` adds the public website's settings.

Run for real against MySQL/MariaDB on uniquely prefixed scratch tables in the
test database (DDL cannot ride in a rolled-back transaction; the pattern of
``test_history_public_settings_migration.py``). Pinned:

* upgrade, downgrade, upgrade, and a re-run of either step changes nothing;
* a row written with nothing but its department reads as a website that is
  off, every page and detail off, in the default theme;
* one row per department, and deleting the department takes its row;
* the columns and the default theme are the model's.
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
from app.models.public_site import PublicSiteSettings, PublicSiteTheme
from app.services.public_site_service import SWITCHES

_PATH = next(
    (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
        "*_7c3a91e5b2d4_*.py"
    )
)


def _migration():
    spec = importlib.util.spec_from_file_location("_public_site_settings", _PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _migration()
_TABLES = ("ORGANIZATIONS", "USERS", "SETTINGS")


@pytest.mark.unit
class TestTheShapeIsTheModels:
    def test_table_name(self):
        assert MIGRATION.SETTINGS == PublicSiteSettings.__tablename__

    def test_the_switches_are_the_models(self):
        assert set(MIGRATION.SWITCHES) == set(SWITCHES)

    def test_the_default_theme_is_a_frozen_copy_of_the_models(self):
        assert MIGRATION._DEFAULT_THEME == PublicSiteTheme.CLASSIC.value


@pytest.fixture
def scratch(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in _TABLES:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.connect() as conn:
        for table in (MIGRATION.ORGANIZATIONS, MIGRATION.USERS):
            conn.exec_driver_sql(
                f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"
            )
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.ORGANIZATIONS} VALUES ('org1'), ('org2')"
        )
        conn.commit()
    try:
        yield SimpleNamespace(engine=engine)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for attr in _TABLES:
                conn.exec_driver_sql(
                    f"DROP TABLE IF EXISTS `{getattr(MIGRATION, attr)}`"
                )
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _run(engine, step) -> None:
    with engine.connect() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            step()
        conn.commit()


def _execute(engine, *statements) -> None:
    with engine.connect() as conn:
        for statement in statements:
            conn.exec_driver_sql(statement)
        conn.commit()


def _has(engine, table) -> bool:
    with engine.connect() as conn:
        return sa.inspect(conn).has_table(table)


@pytest.mark.integration
class TestAgainstARealDatabase:
    def test_upgrade_downgrade_upgrade_and_reruns(self, scratch):
        m = MIGRATION
        _run(scratch.engine, m.upgrade)
        _run(scratch.engine, m.upgrade)
        assert _has(scratch.engine, m.SETTINGS)
        _run(scratch.engine, m.downgrade)
        _run(scratch.engine, m.downgrade)
        assert not _has(scratch.engine, m.SETTINGS)
        _run(scratch.engine, m.upgrade)
        assert _has(scratch.engine, m.SETTINGS)

    def test_the_columns_are_the_models(self, scratch):
        _run(scratch.engine, MIGRATION.upgrade)
        with scratch.engine.connect() as conn:
            columns = {
                c["name"] for c in sa.inspect(conn).get_columns(MIGRATION.SETTINGS)
            }
        assert columns == {c.name for c in PublicSiteSettings.__table__.columns}

    def test_a_bare_row_has_everything_off(self, scratch):
        m = MIGRATION
        _run(scratch.engine, m.upgrade)
        _execute(
            scratch.engine,
            f"INSERT INTO {m.SETTINGS} (id, organization_id) VALUES ('s1', 'org1')",
        )
        with scratch.engine.connect() as conn:
            row = conn.exec_driver_sql(
                f"SELECT {', '.join(m.SWITCHES)}, theme, tagline, about_text "
                f"FROM {m.SETTINGS}"
            ).one()
        *switches, theme, tagline, about_text = row
        assert switches == [0] * len(m.SWITCHES)
        assert (theme, tagline, about_text) == ("classic", None, None)

    def test_one_row_per_department(self, scratch):
        m = MIGRATION
        _run(scratch.engine, m.upgrade)
        _execute(
            scratch.engine,
            f"INSERT INTO {m.SETTINGS} (id, organization_id) VALUES ('s1', 'org1')",
        )
        with pytest.raises(sa.exc.IntegrityError):
            _execute(
                scratch.engine,
                f"INSERT INTO {m.SETTINGS} (id, organization_id) "
                "VALUES ('s2', 'org1')",
            )

    def test_deleting_the_department_takes_its_row(self, scratch):
        m = MIGRATION
        _run(scratch.engine, m.upgrade)
        _execute(
            scratch.engine,
            f"INSERT INTO {m.SETTINGS} (id, organization_id) VALUES ('s1', 'org1')",
            f"DELETE FROM {m.ORGANIZATIONS} WHERE id = 'org1'",
        )
        with scratch.engine.connect() as conn:
            assert (
                conn.exec_driver_sql(f"SELECT COUNT(*) FROM {m.SETTINGS}").scalar_one()
                == 0
            )
