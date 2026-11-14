"""INT2-4: a catalog change reaches departments seeded before it.

Owner decision 2026-11-01: the catalog owns an integration row's name,
description and category, and its status only between ``available`` and
``coming_soon``. Everything a department or the server writes after seeding —
a connection, ``enabled``, config and secrets, ``contains_phi`` — is left as
it is.

Two halves, each tested with rows carrying stale catalog values *and*
department state that must survive:

* migration ``7c41e9a2b6d8`` settles the rows that exist when it runs
  (SQLite, so it runs in the unit job);
* ``ensure_catalog`` keeps doing it whenever the integrations page lists a
  department's rows, so the next catalog change reaches them too (the real
  database).
"""

import importlib.util
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import integrations as endpoints
from app.models.integration import Integration

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_7c41e9a2b6d8_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

STALE = "Seeded long ago"


def _migration():
    spec = importlib.util.spec_from_file_location("reconcile_catalog", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _frozen(itype: str) -> tuple[str, str, str, str]:
    for entry in _migration()._CATALOG:
        if entry[0] == itype:
            return entry[1], entry[2], entry[3], entry[4]
    raise AssertionError(f"{itype} is not in the frozen catalog")


# ---------------------------------------------------------------------------
# The ownership rule
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestCatalogStatus:
    @pytest.mark.parametrize("row", ["available", "coming_soon"])
    @pytest.mark.parametrize("catalog", ["available", "coming_soon"])
    def test_availability_follows_the_catalog(self, row, catalog):
        assert endpoints.catalog_status(catalog, row) == catalog

    @pytest.mark.parametrize("row", ["connected", "error"])
    @pytest.mark.parametrize("catalog", ["available", "coming_soon"])
    def test_a_department_connection_is_kept(self, row, catalog):
        assert endpoints.catalog_status(catalog, row) == row

    def test_department_state_is_not_catalog_owned(self):
        owned = set(endpoints.CATALOG_OWNED_COLUMNS)
        assert owned == {"name", "description", "category"}
        assert not owned & {
            "enabled",
            "config",
            "encrypted_config",
            "contains_phi",
            "status",
        }


# ---------------------------------------------------------------------------
# The migration
# ---------------------------------------------------------------------------


def _run(engine, direction: str = "upgrade") -> None:
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "integrations",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("integration_type", sa.String),
        sa.Column("name", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("category", sa.String),
        sa.Column("status", sa.String),
        sa.Column("config", sa.Text),
        sa.Column("encrypted_config", sa.Text),
        sa.Column("enabled", sa.Boolean),
        sa.Column("contains_phi", sa.Boolean),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _insert(engine, row_id: str, itype: str, **kw) -> None:
    values = {
        "id": row_id,
        "organization_id": kw.get("org", "org-1"),
        "integration_type": itype,
        "name": kw.get("name", STALE),
        "description": kw.get("description", STALE),
        "category": kw.get("category", "Old"),
        "status": kw.get("status", "available"),
        "config": kw.get("config", "{}"),
        "encrypted_config": kw.get("encrypted_config"),
        "enabled": kw.get("enabled", False),
        "contains_phi": kw.get("contains_phi", False),
    }
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO integrations VALUES (:id, :organization_id, "
                ":integration_type, :name, :description, :category, :status, "
                ":config, :encrypted_config, :enabled, :contains_phi)"
            ),
            values,
        )


def _get(engine, row_id: str):
    with engine.connect() as connection:
        return (
            connection.execute(
                sa.text("SELECT * FROM integrations WHERE id = :id"), {"id": row_id}
            )
            .mappings()
            .one()
        )


@pytest.mark.unit
class TestMigration:
    def test_rewrites_the_catalog_owned_columns(self, engine):
        _insert(engine, "slack", "slack", org="org-1")
        _insert(engine, "slack-2", "slack", org="org-2", description=None)

        _run(engine)

        name, description, category, _ = _frozen("slack")
        for row_id in ("slack", "slack-2"):
            row = _get(engine, row_id)
            assert (row["name"], row["description"], row["category"]) == (
                name,
                description,
                category,
            )

    def test_promotes_and_demotes_availability(self, engine):
        # Seeded as coming soon before the catalog promoted it...
        _insert(engine, "zeffy", "zeffy", status="coming_soon")
        # ...and seeded as available before the catalog demoted it.
        _insert(engine, "csv", "csv-import", status="available")

        _run(engine)

        assert _frozen("zeffy")[3] == "available"
        assert _frozen("csv-import")[3] == "coming_soon"
        assert _get(engine, "zeffy")["status"] == "available"
        assert _get(engine, "csv")["status"] == "coming_soon"

    def test_keeps_a_department_connection_and_its_state(self, engine):
        _insert(
            engine,
            "csv",
            "csv-import",
            status="connected",
            enabled=True,
            config='{"delimiter": ";"}',
            encrypted_config="ciphertext",
            contains_phi=True,
        )
        _insert(engine, "mcp", "claude-mcp", status="error", contains_phi=True)

        _run(engine)

        csv = _get(engine, "csv")
        assert csv["status"] == "connected"
        assert csv["enabled"] in (True, 1)
        assert csv["config"] == '{"delimiter": ";"}'
        assert csv["encrypted_config"] == "ciphertext"
        assert csv["contains_phi"] in (True, 1)
        # The catalog-owned columns still moved on the connected row.
        assert csv["description"] == _frozen("csv-import")[1]
        mcp = _get(engine, "mcp")
        assert mcp["status"] == "error"
        assert mcp["contains_phi"] in (True, 1)

    def test_leaves_a_type_the_catalog_no_longer_lists(self, engine):
        _insert(engine, "gone", "retired-integration", status="coming_soon")

        _run(engine)

        row = _get(engine, "gone")
        assert (row["name"], row["description"], row["status"]) == (
            STALE,
            STALE,
            "coming_soon",
        )

    def test_does_nothing_without_the_table(self):
        database = sa.create_engine("sqlite://")
        try:
            _run(database)
        finally:
            database.dispose()

    def test_downgrade_leaves_the_rows(self, engine):
        _insert(engine, "slack", "slack")
        _run(engine)
        _run(engine, "downgrade")
        assert _get(engine, "slack")["name"] == _frozen("slack")[0]


# ---------------------------------------------------------------------------
# ensure_catalog, going forward
# ---------------------------------------------------------------------------


async def _org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Catalog Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"catalog-{org_id[:8]}"},
    )
    return org_id


def _stale_row(org_id: str, itype: str, **kw) -> Integration:
    return Integration(
        organization_id=org_id,
        integration_type=itype,
        name=STALE,
        description=STALE,
        category="Old",
        status=kw.pop("status", "available"),
        config=kw.pop("config", {}),
        enabled=kw.pop("enabled", False),
        contains_phi=kw.pop("contains_phi", False),
    )


async def _rows(db: AsyncSession, org_id: str) -> dict[str, Integration]:
    result = await db.execute(
        select(Integration).where(Integration.organization_id == org_id)
    )
    return {r.integration_type: r for r in result.scalars().all()}


@pytest.mark.integration
class TestEnsureCatalog:
    async def test_reconciles_existing_rows_and_keeps_department_state(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        slack = _stale_row(
            org_id,
            "slack",
            status="connected",
            enabled=True,
            config={"channel": "#ops"},
        )
        slack.set_secret("webhook_url", "https://hooks.slack.com/services/T/B/x")
        promoted = _stale_row(org_id, "paypal", status="coming_soon")
        demoted = _stale_row(org_id, "zapier", status="available")
        connected_demoted = _stale_row(
            org_id, "whatsapp", status="connected", enabled=True
        )
        mcp = _stale_row(org_id, "claude-mcp", status="available", contains_phi=True)
        db_session.add_all([slack, promoted, demoted, connected_demoted, mcp])
        await db_session.flush()

        await endpoints.ensure_catalog(db_session, org_id)
        rows = await _rows(db_session, org_id)

        catalog = endpoints._CATALOG_BY_TYPE
        for itype in ("slack", "paypal", "zapier", "whatsapp", "claude-mcp"):
            row = rows[itype]
            assert row.name == catalog[itype]["name"]
            assert row.description == catalog[itype]["description"]
            assert row.category == catalog[itype]["category"]

        assert catalog["paypal"]["status"] == "available"
        assert catalog["zapier"]["status"] == "coming_soon"
        assert rows["paypal"].status == "available"
        assert rows["zapier"].status == "coming_soon"
        # A department's connection is not the catalog's to undo.
        assert rows["whatsapp"].status == "connected"
        assert rows["whatsapp"].enabled is True
        assert rows["slack"].status == "connected"
        assert rows["slack"].enabled is True
        assert rows["slack"].config == {"channel": "#ops"}
        assert rows["slack"].get_secret("webhook_url") == (
            "https://hooks.slack.com/services/T/B/x"
        )
        assert rows["claude-mcp"].contains_phi is True

        # Every catalog entry is still seeded, once.
        assert set(rows) >= set(catalog)
        assert len(rows) == len(catalog)
