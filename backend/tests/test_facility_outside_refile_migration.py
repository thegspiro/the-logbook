"""Migration 986b38c2086b: facility files filed outside the facility folders.

The owner's 2026-11-01 decision on FAC-13's last open case: a file a facility
record points at, sitting outside that facility's folders, is moved into them
— documents into the restricted Facility Documents folder, photos into Photos.
What matters as much is what is *not* moved: a file another module also owns,
and a file already in one of its own facilities' trees.

The unit half runs the migration against SQLite with rows present; the
integration half runs it against the suite's MySQL/MariaDB, on prefixed scratch
copies, so the real column types (an ENUM, a JSON-checked LONGTEXT) take the
inserts it makes.
"""

import importlib.util
import json
import sqlite3
from datetime import datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# The migration binds a datetime; Python 3.12 deprecated sqlite3's implicit
# adapter, so register the same conversion explicitly.
sqlite3.register_adapter(datetime, lambda value: value.isoformat(" "))

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_986b38c2086b_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

ACCESS = [
    "facilities.view",
    "facilities.view_sensitive",
    "facilities.edit",
    "facilities.manage",
]
SENSITIVE = ["facilities.view_sensitive", "facilities.edit", "facilities.manage"]
OLD_SUBS = [
    "photos",
    "blueprints-permits",
    "maintenance",
    "inspections",
    "insurance-leases",
    "capital-projects",
]
ALL_SUBS = {
    "photos": ACCESS,
    "blueprints-permits": SENSITIVE,
    "maintenance": ACCESS,
    "inspections": ACCESS,
    "insurance-leases": SENSITIVE,
    "capital-projects": SENSITIVE,
    "documents": SENSITIVE,
}
RECORD = "facility_outside_refile_backfill"


def _migration(prefix: str = ""):
    spec = importlib.util.spec_from_file_location("fac13_outside", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if prefix:
        for name in ("FOLDERS", "DOCUMENTS", "FACILITIES", "PHOTOS", "RECORD"):
            setattr(module, name, prefix + getattr(module, name))
        module.FACILITY_DOCUMENTS = prefix + module.FACILITY_DOCUMENTS
        module.OTHER_OWNERS = tuple(
            (prefix + table, column) for table, column in module.OTHER_OWNERS
        )
    return module


def _run(engine, direction="upgrade", prefix=""):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(prefix), direction)()


# ---------------------------------------------------------------- SQLite ---


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table(
        "document_folders",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("parent_id", sa.String),
        sa.Column("name", sa.String),
        sa.Column("slug", sa.String),
        sa.Column("description", sa.Text),
        sa.Column("icon", sa.String),
        sa.Column("color", sa.String),
        sa.Column("sort_order", sa.Integer),
        sa.Column("visibility", sa.String),
        sa.Column("required_permissions", sa.Text),
        sa.Column("is_system", sa.Boolean),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
    )
    sa.Table(
        "documents",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("folder_id", sa.String),
        sa.Column("source_type", sa.String),
    )
    sa.Table(
        "facilities",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("organization_id", sa.String),
        sa.Column("name", sa.String),
    )
    for name in ("facility_photos", "facility_documents"):
        sa.Table(
            name,
            metadata,
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("organization_id", sa.String),
            sa.Column("facility_id", sa.String),
            sa.Column("document_id", sa.String),
            sa.Column("uploaded_at", sa.DateTime),
        )
    sa.Table(
        "apparatus_documents",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("document_id", sa.String),
    )
    sa.Table(
        "purchase_requests",
        metadata,
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("receipt_document_id", sa.String),
    )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _folder(conn, folder_id, org, parent, slug, perms=None, is_system=False):
    conn.execute(
        sa.text(
            "INSERT INTO document_folders (id, organization_id, parent_id, name, "
            "slug, required_permissions, is_system, visibility) VALUES "
            "(:id, :org, :parent, :id, :slug, :perms, :sys, 'organization')"
        ),
        {
            "id": folder_id,
            "org": org,
            "parent": parent,
            "slug": slug,
            "perms": json.dumps(perms) if perms else None,
            "sys": is_system,
        },
    )


def _document(conn, document_id, org, folder_id, source_type=None):
    conn.execute(
        sa.text("INSERT INTO documents VALUES (:id, :org, :folder, :source)"),
        {"id": document_id, "org": org, "folder": folder_id, "source": source_type},
    )


def _reference(conn, table, org, facility_id, document_id, day):
    conn.execute(
        sa.text(f"INSERT INTO {table} VALUES (:id, :org, :facility, :doc, :at)"),
        {
            "id": f"{table}-{facility_id}-{document_id}",
            "org": org,
            "facility": facility_id,
            "doc": document_id,
            "at": datetime(2026, 1, day),
        },
    )


@pytest.fixture
def tree(engine):
    """Org ``o``: facility 1 has a pre-FAC-13 tree (no Facility Documents),
    facility 2 has no folder at all. Org ``p`` has no Facility Files root."""
    with engine.begin() as c:
        c.execute(
            sa.text(
                "INSERT INTO facilities VALUES ('1', 'o', 'Station 1'), "
                "('2', 'o', 'Station 2'), ('p1', 'p', 'P Station')"
            )
        )
        _folder(c, "root", "o", None, "facilities", ACCESS, is_system=True)
        _folder(c, "f1", "o", "root", "facility-1", ACCESS)
        for sub in OLD_SUBS:
            _folder(c, f"f1-{sub}", "o", "f1", f"facility-1-{sub}", ALL_SUBS[sub])
        _folder(c, "general", "o", None, "general", None, is_system=True)
        _folder(c, "vehicle", "o", None, "apparatus", None, is_system=True)
        _folder(c, "general-p", "p", None, "general", None, is_system=True)

        # Moved.
        _document(c, "d-general", "o", "general")
        _reference(c, "facility_documents", "o", "1", "d-general", 1)
        _document(c, "d-photo", "o", "general")
        _reference(c, "facility_photos", "o", "1", "d-photo", 1)
        _document(c, "d-unfiled", "o", None)
        _reference(c, "facility_documents", "o", "2", "d-unfiled", 1)
        _document(c, "d-other-tree", "o", "f1-photos")
        _reference(c, "facility_photos", "o", "2", "d-other-tree", 1)
        _document(c, "d-two", "o", "general")
        _reference(c, "facility_documents", "o", "2", "d-two", 1)
        _reference(c, "facility_documents", "o", "1", "d-two", 5)
        _document(c, "d-mixed", "o", "general")
        _reference(c, "facility_photos", "o", "1", "d-mixed", 1)
        _reference(c, "facility_documents", "o", "2", "d-mixed", 5)
        _document(c, "d-own-source", "o", "general", "facility_document")
        _reference(c, "facility_documents", "o", "1", "d-own-source", 1)
        _document(c, "d-p", "p", "general-p")
        _reference(c, "facility_documents", "p", "p1", "d-p", 1)

        # Left where they are.
        _document(c, "d-in-tree", "o", "f1-maintenance")
        _reference(c, "facility_documents", "o", "1", "d-in-tree", 1)
        _document(c, "d-apparatus", "o", "vehicle")
        _reference(c, "facility_documents", "o", "1", "d-apparatus", 1)
        c.execute(
            sa.text("INSERT INTO apparatus_documents VALUES ('a', 'd-apparatus')")
        )
        _document(c, "d-receipt", "o", "general")
        _reference(c, "facility_photos", "o", "1", "d-receipt", 1)
        c.execute(sa.text("INSERT INTO purchase_requests VALUES ('r', 'd-receipt')"))
        _document(c, "d-minutes", "o", "general", "meeting_minutes")
        _reference(c, "facility_documents", "o", "1", "d-minutes", 1)
        _document(c, "d-unreferenced", "o", "general")
        # Another department's reference naming this department's document.
        _document(c, "d-cross-org", "o", "general")
        _reference(c, "facility_documents", "p", "p1", "d-cross-org", 1)
        # A reference to a facility that no longer exists.
        _document(c, "d-orphan", "o", "general")
        _reference(c, "facility_documents", "o", "gone", "d-orphan", 1)
    return engine


def _where(engine, document_id):
    """(slug of the document's folder, slug of that folder's parent)."""
    with engine.begin() as c:
        row = c.execute(
            sa.text(
                "SELECT f.slug, p.slug FROM documents d "
                "LEFT JOIN document_folders f ON f.id = d.folder_id "
                "LEFT JOIN document_folders p ON p.id = f.parent_id "
                "WHERE d.id = :i"
            ),
            {"i": document_id},
        ).first()
    return tuple(row)


def _folders(engine, org):
    with engine.begin() as c:
        rows = c.execute(
            sa.text(
                "SELECT slug, parent_id, required_permissions, is_system, name "
                "FROM document_folders WHERE organization_id = :org"
            ),
            {"org": org},
        ).all()
    return {
        r.slug: {
            "parent_id": r.parent_id,
            "perms": (
                json.loads(r.required_permissions) if r.required_permissions else None
            ),
            "is_system": bool(r.is_system),
            "name": r.name,
        }
        for r in rows
    }


def _snapshot(engine):
    with engine.begin() as c:
        folders = c.execute(
            sa.text(
                "SELECT id, parent_id, slug, required_permissions "
                "FROM document_folders ORDER BY id"
            )
        ).all()
        documents = c.execute(
            sa.text("SELECT id, folder_id FROM documents ORDER BY id")
        ).all()
    return [tuple(r) for r in folders], [tuple(r) for r in documents]


def _tables(engine):
    with engine.connect() as c:
        return set(sa.inspect(c).get_table_names())


@pytest.mark.unit
class TestRefilingWithRowsPresent:
    def test_a_file_outside_its_facility_moves_into_the_facility_tree(self, tree):
        _run(tree)

        assert _where(tree, "d-general") == ("facility-1-documents", "facility-1")
        assert _where(tree, "d-photo") == ("facility-1-photos", "facility-1")
        assert _where(tree, "d-own-source") == ("facility-1-documents", "facility-1")
        # Unfiled is organization-level, the widest exposure: it moves too.
        assert _where(tree, "d-unfiled") == ("facility-2-documents", "facility-2")
        # Another facility's tree is outside this facility's.
        assert _where(tree, "d-other-tree") == ("facility-2-photos", "facility-2")
        # No root at all: the whole chain is built.
        assert _where(tree, "d-p") == ("facility-p1-documents", "facility-p1")

    def test_two_facilities_the_oldest_reference_and_the_stricter_tier_win(self, tree):
        _run(tree)

        # Facility 2's reference is older.
        assert _where(tree, "d-two") == ("facility-2-documents", "facility-2")
        # Facility 1 points at it as a photo, earlier; facility 2 as a
        # document. The document reference decides: restricted folder.
        assert _where(tree, "d-mixed") == ("facility-2-documents", "facility-2")

    def test_what_another_module_owns_or_its_tree_holds_stays_put(self, tree):
        _run(tree)

        assert _where(tree, "d-in-tree") == ("facility-1-maintenance", "facility-1")
        assert _where(tree, "d-apparatus") == ("apparatus", None)
        assert _where(tree, "d-receipt") == ("general", None)
        assert _where(tree, "d-minutes") == ("general", None)
        assert _where(tree, "d-unreferenced") == ("general", None)
        assert _where(tree, "d-cross-org") == ("general", None)
        assert _where(tree, "d-orphan") == ("general", None)

    def test_folders_are_created_as_ensure_facility_folder_would(self, tree):
        _run(tree)

        o = _folders(tree, "o")
        # Facility 1 only gains the missing sub-folder.
        assert o["facility-1-documents"]["perms"] == SENSITIVE
        assert o["facility-1-documents"]["parent_id"] == "f1"
        assert o["facility-1-documents"]["name"] == "Facility Documents"
        # Facility 2 gets its folder and all seven sub-folders on their tiers.
        assert o["facility-2"]["perms"] == ACCESS
        assert o["facility-2"]["parent_id"] == "root"
        assert o["facility-2"]["name"] == "Station 2"
        for sub, perms in ALL_SUBS.items():
            assert o[f"facility-2-{sub}"]["perms"] == perms, sub

        p = _folders(tree, "p")
        assert p["facilities"]["is_system"] is True
        assert p["facilities"]["parent_id"] is None
        assert p["facilities"]["perms"] == ACCESS
        assert p["facilities"]["name"] == "Facility Files"
        assert len([s for s in p if s.startswith("facility-p1-")]) == 7

    def test_running_it_twice_changes_nothing_more(self, tree):
        _run(tree)
        first = _snapshot(tree)
        _run(tree)
        assert _snapshot(tree) == first

    def test_the_downgrade_puts_everything_back(self, tree):
        before = _snapshot(tree)
        _run(tree)
        assert _snapshot(tree) != before
        _run(tree, "downgrade")

        assert _snapshot(tree) == before
        assert RECORD not in _tables(tree)

    def test_the_downgrade_leaves_what_happened_since_alone(self, tree):
        _run(tree)
        with tree.begin() as c:
            c.execute(
                sa.text("UPDATE documents SET folder_id = 'vehicle' WHERE id = 'd-p'")
            )
            # A file uploaded since into a folder this created.
            created = c.execute(
                sa.text(
                    "SELECT id FROM document_folders "
                    "WHERE slug = 'facility-2-inspections'"
                )
            ).scalar()
            _document(c, "d-new", "o", created, "facility_document")
        _run(tree, "downgrade")

        assert _where(tree, "d-general") == ("general", None)
        assert _where(tree, "d-p") == ("apparatus", None)
        assert _where(tree, "d-new") == ("facility-2-inspections", "facility-2")
        o = _folders(tree, "o")
        # The occupied folder and its parent survive; its empty siblings go.
        assert "facility-2" in o
        assert "facility-2-documents" not in o


@pytest.mark.unit
class TestNothingToDo:
    def test_no_file_outside_leaves_no_bookkeeping_table(self, engine):
        with engine.begin() as c:
            c.execute(sa.text("INSERT INTO facilities VALUES ('1', 'o', 'S1')"))
            _folder(c, "root", "o", None, "facilities", ACCESS, is_system=True)
            _folder(c, "f1", "o", "root", "facility-1", ACCESS)
            _folder(c, "f1-documents", "o", "f1", "facility-1-documents", SENSITIVE)
            _document(c, "d", "o", "f1-documents")
            _reference(c, "facility_documents", "o", "1", "d", 1)
        before = _snapshot(engine)

        _run(engine)

        assert _snapshot(engine) == before
        assert RECORD not in _tables(engine)

    def test_a_database_without_the_tables_is_left_alone(self):
        database = sa.create_engine("sqlite://")
        try:
            _run(database)
            _run(database, "downgrade")
            assert _tables(database) == set()
        finally:
            database.dispose()


# --------------------------------------------------------- MySQL/MariaDB ---

_PREFIX = "outsiderefilemig_"


def _scratch_tables():
    p = _PREFIX
    return {
        f"{p}document_folders": (
            "id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, "
            "name VARCHAR(255) NOT NULL, description TEXT, "
            "color VARCHAR(20) DEFAULT '#3B82F6', icon VARCHAR(50) DEFAULT 'folder', "
            "parent_id VARCHAR(36), created_at DATETIME, updated_at DATETIME, "
            "slug VARCHAR(100), is_system TINYINT(1) NOT NULL DEFAULT 0, "
            "sort_order INT NOT NULL DEFAULT 0, "
            "visibility ENUM('organization','leadership','owner') NOT NULL "
            "DEFAULT 'organization', "
            "required_permissions LONGTEXT CHECK (json_valid(required_permissions))"
        ),
        f"{p}documents": (
            "id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, "
            "folder_id VARCHAR(36), source_type VARCHAR(50)"
        ),
        f"{p}facilities": (
            "id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, "
            "name VARCHAR(200) NOT NULL"
        ),
        f"{p}facility_documents": (
            "id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, "
            "facility_id VARCHAR(36) NOT NULL, document_id VARCHAR(36), "
            "uploaded_at DATETIME"
        ),
        f"{p}facility_photos": (
            "id VARCHAR(36) PRIMARY KEY, organization_id VARCHAR(36) NOT NULL, "
            "facility_id VARCHAR(36) NOT NULL, document_id VARCHAR(36), "
            "uploaded_at DATETIME"
        ),
        f"{p}apparatus_documents": "id VARCHAR(36) PRIMARY KEY, document_id VARCHAR(36)",
    }


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    database = sa.create_engine(settings.SYNC_DATABASE_URL)
    names = list(_scratch_tables()) + [_PREFIX + RECORD]

    def _clean():
        with database.begin() as conn:
            for name in names:
                conn.execute(sa.text(f"DROP TABLE IF EXISTS {name}"))

    _clean()
    with database.begin() as conn:
        for name, columns in _scratch_tables().items():
            conn.execute(sa.text(f"CREATE TABLE {name} ({columns}) ENGINE=InnoDB"))
    yield database
    _clean()
    database.dispose()


@pytest.mark.integration
class TestOnTheRealDialect:
    def test_upgrade_moves_creates_and_downgrade_restores(self, scratch_engine):
        p = _PREFIX
        with scratch_engine.begin() as c:
            c.execute(
                sa.text(
                    f"INSERT INTO {p}facilities VALUES "
                    "('fac-1', 'org', 'Station 1'), ('fac-2', 'org', 'Station 2')"
                )
            )
            c.execute(
                sa.text(
                    f"INSERT INTO {p}document_folders "
                    "(id, organization_id, name, slug, is_system) VALUES "
                    "('general', 'org', 'General', 'general', 1)"
                )
            )
            c.execute(
                sa.text(
                    f"INSERT INTO {p}documents VALUES "
                    "('d-doc', 'org', 'general', NULL), "
                    "('d-photo', 'org', NULL, NULL), "
                    "('d-vehicle', 'org', 'general', 'apparatus_document')"
                )
            )
            c.execute(
                sa.text(
                    f"INSERT INTO {p}facility_documents VALUES "
                    "('r1', 'org', 'fac-1', 'd-doc', '2026-01-01'), "
                    "('r3', 'org', 'fac-1', 'd-vehicle', '2026-01-01')"
                )
            )
            c.execute(
                sa.text(
                    f"INSERT INTO {p}facility_photos VALUES "
                    "('r2', 'org', 'fac-2', 'd-photo', NULL)"
                )
            )
            c.execute(
                sa.text(f"INSERT INTO {p}apparatus_documents VALUES ('a', 'd-vehicle')")
            )

        _run(scratch_engine, prefix=p)

        with scratch_engine.connect() as c:
            placed = dict(
                c.execute(
                    sa.text(
                        f"SELECT d.id, f.slug FROM {p}documents d "
                        f"LEFT JOIN {p}document_folders f ON f.id = d.folder_id"
                    )
                ).all()
            )
            perms = dict(
                c.execute(
                    sa.text(
                        f"SELECT slug, required_permissions FROM {p}document_folders"
                    )
                ).all()
            )
        assert placed == {
            "d-doc": "facility-fac-1-documents",
            "d-photo": "facility-fac-2-photos",
            "d-vehicle": "general",
        }
        assert json.loads(perms["facilities"]) == ACCESS
        assert json.loads(perms["facility-fac-1-documents"]) == SENSITIVE
        assert json.loads(perms["facility-fac-2-photos"]) == ACCESS

        _run(scratch_engine, "downgrade", prefix=p)

        with scratch_engine.connect() as c:
            after = dict(
                c.execute(sa.text(f"SELECT id, folder_id FROM {p}documents")).all()
            )
            slugs = (
                c.execute(sa.text(f"SELECT slug FROM {p}document_folders"))
                .scalars()
                .all()
            )
            tables = set(sa.inspect(c).get_table_names())
        assert after == {"d-doc": "general", "d-photo": None, "d-vehicle": "general"}
        assert slugs == ["general"]
        assert p + RECORD not in tables
