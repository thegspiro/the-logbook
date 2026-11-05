"""Migration 2bb7c963f351: settle duplicate location names, then enforce them.

Run against MySQL with the duplicates present, because a unique key that holds
on an empty table proves nothing (CLAUDE.md Pitfall #35), and because what
counts as a duplicate is the column collation's call — case and trailing
spaces included — which no other engine reproduces.

The DDL autocommits, so the migration runs against throwaway tables under a
prefix in the suite's own database (the shape
``test_attribution_set_null_migration.py`` uses); the real tables are never
altered.
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text

from app.models.location import Location

pytestmark = [pytest.mark.integration]

_REVISION = "2bb7c963f351"
_PREFIX = "locuqmig_"
_LOCATIONS = _PREFIX + "locations"
_MEETINGS = _PREFIX + "meetings"
_ITEMS = _PREFIX + "items"
_ORG_A = "org-a"
_ORG_B = "org-b"


def _load_migration():
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    matches = sorted(versions.glob(f"*_{_REVISION}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("location_name_unique", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _drop_scratch(conn) -> None:
    for table in (_MEETINGS, _ITEMS, _LOCATIONS):
        conn.execute(text(f"DROP TABLE IF EXISTS {table}"))


# (id, org, name, building, created_at) — ids sort in creation order only where
# the created_at ties, so the tie-break is exercised too.
_ROWS = [
    ("a1", _ORG_A, "Bunk Room", "HQ", "2026-01-01 08:00:00"),
    ("a2", _ORG_A, "Bunk Room", "HQ", "2026-01-02 08:00:00"),
    ("a3", _ORG_A, "bunk room", "hq", "2026-01-03 08:00:00"),
    # Already holds the first suffix a renamed duplicate would take.
    ("a4", _ORG_A, "Bunk Room (2)", "HQ", "2026-01-04 08:00:00"),
    ("b1", _ORG_A, "Day Room", None, "2026-02-01 08:00:00"),
    ("b3", _ORG_A, "Day Room", "", "2026-02-01 08:00:00"),
    ("b2", _ORG_A, "Day Room", None, "2026-02-01 08:00:00"),
    ("c1", _ORG_A, "A" * 200, None, "2026-03-01 08:00:00"),
    ("c2", _ORG_A, "A" * 200, None, "2026-03-02 08:00:00"),
    # Not duplicates: another building, another department.
    ("d1", _ORG_A, "Bunk Room", "Station 2", "2026-04-01 08:00:00"),
    ("e1", _ORG_B, "Bunk Room", "HQ", "2026-04-01 08:00:00"),
]


@pytest.fixture
def scratch():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    with engine.begin() as conn:
        _drop_scratch(conn)
        conn.execute(
            text(
                f"CREATE TABLE {_LOCATIONS} (id VARCHAR(36) PRIMARY KEY, "
                "organization_id VARCHAR(36) NOT NULL, name VARCHAR(200) NOT NULL, "
                "building VARCHAR(100) NULL, created_at DATETIME NOT NULL) "
                "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            )
        )
        for table in (_MEETINGS, _ITEMS):
            conn.execute(
                text(
                    f"CREATE TABLE {table} (id VARCHAR(36) PRIMARY KEY, "
                    "location_id VARCHAR(36) NULL, "
                    f"CONSTRAINT fk_{table}_location_id FOREIGN KEY (location_id) "
                    f"REFERENCES {_LOCATIONS} (id) ON DELETE SET NULL) "
                    "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                )
            )
        for row in _ROWS:
            conn.execute(
                text(
                    f"INSERT INTO {_LOCATIONS} "
                    "(id, organization_id, name, building, created_at) "
                    "VALUES (:id, :org, :name, :building, :created)"
                ),
                dict(zip(("id", "org", "name", "building", "created"), row)),
            )
    yield engine
    with engine.begin() as conn:
        _drop_scratch(conn)
    engine.dispose()


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    module._LOCATIONS = _LOCATIONS
    module._PROTECTED = [(_MEETINGS, "location_id")]
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


def _names(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return dict(conn.execute(text(f"SELECT id, name FROM {_LOCATIONS}")).all())


def _delete_rules(engine, table: str) -> list[str]:
    with engine.connect() as conn:
        return sorted(
            conn.execute(
                text(
                    "SELECT r.delete_rule FROM information_schema.key_column_usage k "
                    "JOIN information_schema.referential_constraints r "
                    "  ON r.constraint_schema = k.constraint_schema "
                    " AND r.constraint_name = k.constraint_name "
                    " AND r.table_name = k.table_name "
                    "WHERE k.table_schema = DATABASE() AND k.table_name = :t "
                    "  AND k.column_name = 'location_id'"
                ),
                {"t": table},
            ).scalars()
        )


def _has_unique(engine) -> bool:
    inspector = sa.inspect(engine)
    return any(
        index["name"] == "uq_locations_org_name_building" and index["unique"]
        for index in inspector.get_indexes(_LOCATIONS)
    )


def _insert(engine, name: str, building: str | None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"INSERT INTO {_LOCATIONS} (id, organization_id, name, building, "
                "created_at) VALUES (:id, :org, :name, :building, NOW())"
            ),
            {
                "id": str(uuid.uuid4()),
                "org": _ORG_A,
                "name": name,
                "building": building,
            },
        )


_SETTLED = {
    "a1": "Bunk Room",
    "a2": "Bunk Room (3)",
    "a3": "bunk room (4)",
    "a4": "Bunk Room (2)",
    "b1": "Day Room",
    "b2": "Day Room (2)",
    "b3": "Day Room (3)",
    "c1": "A" * 200,
    "c2": "A" * 196 + " (2)",
    "d1": "Bunk Room",
    "e1": "Bunk Room",
}


class TestUpgrade:
    def test_duplicates_are_renamed_oldest_first_before_the_key(self, scratch):
        _run(scratch, "upgrade")

        assert _names(scratch) == _SETTLED
        assert _has_unique(scratch)

    @pytest.mark.parametrize("building", ["HQ", None, ""])
    def test_the_key_then_refuses_a_duplicate_including_no_building(
        self, scratch, building
    ):
        _run(scratch, "upgrade")

        with pytest.raises(sa.exc.IntegrityError):
            _insert(scratch, "Day Room" if building != "HQ" else "Bunk Room", building)

    def test_protected_references_become_restrict_and_others_do_not(self, scratch):
        _run(scratch, "upgrade")

        assert _delete_rules(scratch, _MEETINGS) == ["RESTRICT"]
        assert _delete_rules(scratch, _ITEMS) == ["SET NULL"]

    def test_a_second_upgrade_changes_nothing(self, scratch):
        _run(scratch, "upgrade")

        _run(scratch, "upgrade")

        assert _names(scratch) == _SETTLED
        assert _delete_rules(scratch, _MEETINGS) == ["RESTRICT"]


class TestDowngrade:
    def test_drops_the_key_and_restores_set_null_keeping_the_new_names(self, scratch):
        _run(scratch, "upgrade")

        _run(scratch, "downgrade")

        assert not _has_unique(scratch)
        assert "building_key" not in {
            c["name"] for c in sa.inspect(scratch).get_columns(_LOCATIONS)
        }
        assert _delete_rules(scratch, _MEETINGS) == ["SET NULL"]
        assert _names(scratch) == _SETTLED
        _insert(scratch, "Bunk Room", "HQ")


def test_a_database_without_the_tables_is_skipped():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)
    try:
        with engine.begin() as conn:
            _drop_scratch(conn)
        _run(engine, "upgrade")
        _run(engine, "downgrade")
    finally:
        engine.dispose()


class TestModelMatchesMigration:
    def test_the_model_declares_the_key_over_building_key(self):
        constraints = {
            c.name: [col.name for col in c.columns]
            for c in Location.__table__.constraints
            if isinstance(c, sa.UniqueConstraint)
        }

        assert constraints["uq_locations_org_name_building"] == [
            "organization_id",
            "name",
            "building_key",
        ]
        computed = Location.__table__.c.building_key.computed
        assert computed is not None
        assert computed.persisted is True
