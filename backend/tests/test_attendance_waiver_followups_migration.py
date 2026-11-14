"""``5e2b9c7d1a40`` widens the waiver request ENUMs and adds two columns.

Run for real against MySQL/MariaDB on prefixed scratch tables built by
``8b1cf6f55425`` (the harness of ``test_attendance_waiver_migration.py``), with
rows already in them, because the step that matters is what happens to those
rows (CLAUDE.md pitfall #35). Pinned:

* existing requests and decision-log rows read exactly as before the upgrade,
  with both new columns NULL;
* the new statuses and actions can be written once it has run;
* the downgrade turns an expired request into a voided one and deletes the
  new kinds of decision-log row, so the narrowed ENUMs accept every row left;
* a re-run of either step changes nothing.
"""

import uuid
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from tests.test_attendance_waiver_migration import (
    _PREFIXED,
    FOLLOWUPS,
    MIGRATION,
    _insert,
    _parents,
    _run,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def built(monkeypatch):
    prefix = f"t{uuid.uuid4().hex[:6]}_"
    for attr in _PREFIXED:
        monkeypatch.setattr(MIGRATION, attr, f"{prefix}{getattr(MIGRATION, attr)}")
    for attr in ("REQUESTS", "ACTIONS"):
        monkeypatch.setattr(FOLLOWUPS, attr, getattr(MIGRATION, attr))
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    _parents(engine)
    _run(engine, MIGRATION.upgrade)
    with engine.connect() as conn:
        _insert(conn, "pending-1", "training_session:e:u-1")
        _insert(conn, "approved-1", None)
        conn.exec_driver_sql(
            f"UPDATE {MIGRATION.REQUESTS} SET status = 'approved' "
            "WHERE id = 'approved-1'"
        )
        conn.exec_driver_sql(
            f"INSERT INTO {MIGRATION.ACTIONS} (id, organization_id, request_id, "
            "action) VALUES ('a-1', 'org', 'approved-1', 'approved')"
        )
        conn.commit()
    try:
        yield SimpleNamespace(engine=engine)
    finally:
        with engine.connect() as conn:
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 0")
            for attr in _PREFIXED:
                conn.exec_driver_sql(
                    f"DROP TABLE IF EXISTS `{getattr(MIGRATION, attr)}`"
                )
            conn.exec_driver_sql("SET FOREIGN_KEY_CHECKS = 1")
            conn.commit()
        engine.dispose()


def _requests(engine) -> dict:
    with engine.connect() as conn:
        rows = conn.exec_driver_sql(
            f"SELECT id, status, live_key FROM {MIGRATION.REQUESTS} ORDER BY id"
        ).all()
    return {r[0]: (r[1], r[2]) for r in rows}


def _actions(engine) -> list:
    with engine.connect() as conn:
        return sorted(
            r[0]
            for r in conn.exec_driver_sql(
                f"SELECT action FROM {MIGRATION.ACTIONS}"
            ).all()
        )


def _columns(engine) -> set:
    with engine.connect() as conn:
        return {c["name"] for c in sa.inspect(conn).get_columns(MIGRATION.REQUESTS)}


class TestUpgradeWithRowsPresent:
    def test_existing_rows_are_untouched(self, built):
        before = _requests(built.engine)
        for _ in range(2):
            _run(built.engine, FOLLOWUPS.upgrade)
        assert _requests(built.engine) == before
        assert _actions(built.engine) == ["approved"]
        assert set(FOLLOWUPS._COLUMNS) <= _columns(built.engine)
        with built.engine.connect() as conn:
            nulls = conn.exec_driver_sql(
                f"SELECT COUNT(*) FROM {MIGRATION.REQUESTS} WHERE "
                "info_requested_at IS NULL AND reconfirm_requested_at IS NULL"
            ).scalar_one()
        assert nulls == 2

    def test_the_new_states_are_accepted(self, built):
        _run(built.engine, FOLLOWUPS.upgrade)
        with built.engine.connect() as conn:
            conn.exec_driver_sql(
                f"UPDATE {MIGRATION.REQUESTS} SET status = 'expired', "
                "live_key = NULL WHERE id = 'pending-1'"
            )
            for i, action in enumerate(FOLLOWUPS._ADDED_ACTIONS):
                conn.exec_driver_sql(
                    f"INSERT INTO {MIGRATION.ACTIONS} (id, organization_id, "
                    "request_id, action) VALUES (%s, 'org', 'pending-1', %s)",
                    (f"n-{i}", action),
                )
            conn.commit()
        assert _requests(built.engine)["pending-1"] == ("expired", None)


class TestDowngrade:
    def test_new_states_fold_into_old_ones(self, built):
        _run(built.engine, FOLLOWUPS.upgrade)
        with built.engine.connect() as conn:
            conn.exec_driver_sql(
                f"UPDATE {MIGRATION.REQUESTS} SET status = 'expired' "
                "WHERE id = 'pending-1'"
            )
            conn.exec_driver_sql(
                f"INSERT INTO {MIGRATION.ACTIONS} (id, organization_id, "
                "request_id, action) VALUES ('n-1', 'org', 'pending-1', 'expired')"
            )
            conn.commit()

        for _ in range(2):
            _run(built.engine, FOLLOWUPS.downgrade)

        assert _requests(built.engine) == {
            "approved-1": ("approved", None),
            "pending-1": ("voided", None),
        }
        assert _actions(built.engine) == ["approved"]
        assert not set(FOLLOWUPS._COLUMNS) & _columns(built.engine)
        with built.engine.connect() as conn:
            with pytest.raises(sa.exc.DataError):
                conn.exec_driver_sql(
                    f"UPDATE {MIGRATION.REQUESTS} SET status = 'expired' "
                    "WHERE id = 'approved-1'"
                )
