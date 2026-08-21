"""The storage-area barcode backfill, driven through a real Alembic context.

Areas created before barcodes were mandatory carry NULL, which leaves a shelf
that cannot be scanned. The upgrade hands each one the next code in its
organization's series and advances the counter the API generator reads, so the
two never hand out the same number.

SQLite is enough: the migration inspects table names and issues plain
SELECT/UPDATE, nothing dialect-specific.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# Located by suffix, not by full filename: the date prefix gets renumbered
# whenever main lands a migration claiming this one's revision id or parent.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_backfill_storage_area_barcodes.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]
_RECONCILIATIONS = sorted(_VERSIONS.glob("*_reconcile_storage_area_barcodes.py"))
assert (
    len(_RECONCILIATIONS) == 1
), f"expected exactly one reconciliation migration, found {_RECONCILIATIONS}"
RECONCILIATION = _RECONCILIATIONS[0]


def _load_migration(path=MIGRATION):
    spec = importlib.util.spec_from_file_location(
        "backfill_storage_area_barcodes", path
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


@pytest.fixture
def tables(engine):
    """The subset of the real schema the migration touches."""
    metadata = sa.MetaData()
    areas = sa.Table(
        "storage_areas",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36)),
        sa.Column("name", sa.String(255)),
        sa.Column("barcode", sa.String(255)),
        sa.Column("is_active", sa.Boolean()),
        sa.Column("created_at", sa.DateTime()),
    )
    orgs = sa.Table(
        "organizations",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("settings", sa.Text()),
    )
    metadata.create_all(engine)
    return areas, orgs


def _seed(engine, areas, orgs, *, area_rows, org_rows):
    with engine.begin() as conn:
        for org_id, settings in org_rows:
            conn.execute(orgs.insert().values(id=org_id, settings=json.dumps(settings)))
        for index, row in enumerate(area_rows):
            conn.execute(
                areas.insert().values(
                    id=row["id"],
                    organization_id=row["organization_id"],
                    name=row.get("name", row["id"]),
                    barcode=row.get("barcode"),
                    is_active=row.get("is_active", True),
                    created_at=sa.func.datetime(f"2026-01-01 00:00:{index:02d}"),
                )
            )


def _run(engine, direction: str, path=MIGRATION):
    module = _load_migration(path)
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _barcodes(engine) -> dict[str, str]:
    with engine.connect() as conn:
        return {
            row.id: row.barcode
            for row in conn.execute(sa.text("SELECT id, barcode FROM storage_areas"))
        }


def _settings(engine, org_id: str) -> dict:
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT settings FROM organizations WHERE id = :id"),
            {"id": org_id},
        ).scalar_one()
    return json.loads(raw)


class TestUpgrade:
    def test_is_a_no_op_when_the_tables_do_not_exist(self, engine):
        _run(engine, "upgrade")
        assert not sa.inspect(engine).has_table("storage_areas")

    def test_numbers_areas_in_creation_order(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[
                {"id": "a1", "organization_id": "org-1"},
                {"id": "a2", "organization_id": "org-1"},
            ],
        )

        _run(engine, "upgrade")

        assert _barcodes(engine) == {"a1": "SA-000001", "a2": "SA-000002"}
        assert _settings(engine, "org-1")["storage_area_barcode"] == {
            "prefix": "SA-",
            "next_number": 3,
        }

    def test_leaves_an_existing_barcode_alone(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[
                {"id": "a1", "organization_id": "org-1", "barcode": "LEGACY-1"},
                {"id": "a2", "organization_id": "org-1"},
            ],
        )

        _run(engine, "upgrade")

        assert _barcodes(engine)["a1"] == "LEGACY-1"
        assert _barcodes(engine)["a2"] == "SA-000001"

    def test_skips_a_number_already_taken_in_the_org(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[
                # A soft-deleted area still holds its number: the printed label
                # is on the shelf either way.
                {
                    "id": "a1",
                    "organization_id": "org-1",
                    "barcode": "SA-000001",
                    "is_active": False,
                },
                {"id": "a2", "organization_id": "org-1"},
            ],
        )

        _run(engine, "upgrade")

        assert _barcodes(engine)["a2"] == "SA-000002"

    def test_continues_from_the_counter_already_stored(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[
                ("org-1", {"storage_area_barcode": {"prefix": "SA-", "next_number": 9}})
            ],
            area_rows=[{"id": "a1", "organization_id": "org-1"}],
        )

        _run(engine, "upgrade")

        assert _barcodes(engine)["a1"] == "SA-000009"
        assert _settings(engine, "org-1")["storage_area_barcode"]["next_number"] == 10

    def test_numbers_each_organization_separately(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {}), ("org-2", {})],
            area_rows=[
                {"id": "a1", "organization_id": "org-1"},
                {"id": "a2", "organization_id": "org-2"},
            ],
        )

        _run(engine, "upgrade")

        assert _barcodes(engine) == {"a1": "SA-000001", "a2": "SA-000001"}

    def test_keeps_unrelated_org_settings(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {"barcode": {"prefix": "INV-", "next_number": 40}})],
            area_rows=[{"id": "a1", "organization_id": "org-1"}],
        )

        _run(engine, "upgrade")

        settings = _settings(engine, "org-1")
        # The item series must not be disturbed by the area series.
        assert settings["barcode"] == {"prefix": "INV-", "next_number": 40}
        assert settings["storage_area_barcode"]["next_number"] == 2

    def test_is_idempotent(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[{"id": "a1", "organization_id": "org-1"}],
        )

        _run(engine, "upgrade")
        _run(engine, "upgrade")

        assert _barcodes(engine)["a1"] == "SA-000001"
        assert _settings(engine, "org-1")["storage_area_barcode"]["next_number"] == 2


class TestDowngrade:
    def test_leaves_the_backfilled_codes_in_place(self, engine, tables):
        """A blanket clear would also wipe codes assigned after the upgrade."""
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[{"id": "a1", "organization_id": "org-1"}],
        )
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _barcodes(engine)["a1"] == "SA-000001"


class TestRevisionCollisionReconciliation:
    def test_backfills_an_install_already_stamped_at_the_colliding_revision(
        self, engine, tables
    ):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[
                {"id": "used", "organization_id": "org-1", "barcode": "SA-000001"},
                {"id": "missing", "organization_id": "org-1"},
            ],
        )

        # This models a database where Alembic skipped the original backfill
        # because the old vendor migration had already stamped 20260816_0002.
        _run(engine, "upgrade", RECONCILIATION)

        assert _barcodes(engine)["missing"] == "SA-000002"
        assert _settings(engine, "org-1")["storage_area_barcode"] == {
            "prefix": "SA-",
            "next_number": 3,
        }

    def test_is_a_no_op_after_the_original_backfill(self, engine, tables):
        areas, orgs = tables
        _seed(
            engine,
            areas,
            orgs,
            org_rows=[("org-1", {})],
            area_rows=[{"id": "a1", "organization_id": "org-1"}],
        )

        _run(engine, "upgrade")
        before = (_barcodes(engine), _settings(engine, "org-1"))
        _run(engine, "upgrade", RECONCILIATION)

        assert (_barcodes(engine), _settings(engine, "org-1")) == before
