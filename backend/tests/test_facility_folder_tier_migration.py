"""Migration 65128d5ccd50: the facility tree's two tiers, and the refiling (FAC-13).

Run against a real (SQLite) connection. What matters most is what does NOT
become readable by someone new: every file that sat directly in the root or a
facility's own folder — sensitive by inheritance until now — must land in a
restricted folder, except a file a facility photo points at, which goes to
Photos, the audience the decision opens.
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

pytestmark = pytest.mark.unit

# Python 3.12 deprecated sqlite3's implicit datetime adapter, which the
# migration under test relies on when it binds a datetime. Registering the
# same conversion explicitly keeps the stored text identical.
sqlite3.register_adapter(datetime, lambda value: value.isoformat(" "))

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_65128d5ccd50_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"

ACCESS = [
    "facilities.view",
    "facilities.view_sensitive",
    "facilities.edit",
    "facilities.manage",
]
SENSITIVE = ["facilities.view_sensitive", "facilities.edit", "facilities.manage"]
SUBS = [
    "photos",
    "blueprints-permits",
    "maintenance",
    "inspections",
    "insurance-leases",
    "capital-projects",
]


def _migration():
    spec = importlib.util.spec_from_file_location("fac13_migration", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, direction="upgrade"):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(_migration(), direction)()


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
    )
    for name in ("facility_photos", "facility_documents"):
        sa.Table(
            name,
            metadata,
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("organization_id", sa.String),
            sa.Column("facility_id", sa.String),
            sa.Column("document_id", sa.String),
        )
    metadata.create_all(database)
    try:
        yield database
    finally:
        database.dispose()


def _folder(conn, folder_id, org, parent, slug, perms, is_system=False):
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


def _document(conn, document_id, org, folder_id):
    conn.execute(
        sa.text("INSERT INTO documents VALUES (:id, :org, :folder)"),
        {"id": document_id, "org": org, "folder": folder_id},
    )


def _reference(conn, table, org, facility_id, document_id):
    conn.execute(
        sa.text(f"INSERT INTO {table} VALUES (:id, :org, :facility, :doc)"),
        {
            "id": f"{table}-{document_id}-{org}",
            "org": org,
            "facility": facility_id,
            "doc": document_id,
        },
    )


@pytest.fixture
def tree(engine):
    """One department with two facilities, pre-FAC-13 (all sensitive)."""
    with engine.begin() as c:
        _folder(c, "root", "o", None, "facilities", SENSITIVE, is_system=True)
        _folder(c, "f1", "o", "root", "facility-1", SENSITIVE)
        for sub in SUBS:
            _folder(c, f"f1-{sub}", "o", "f1", f"facility-1-{sub}", SENSITIVE)
        _folder(c, "f2", "o", "root", "facility-2", SENSITIVE)
        _folder(c, "custom", "o", "f1", "my-folder", None)
        _folder(c, "custom-in-photos", "o", "f1-photos", "deep", None)
        _folder(c, "elsewhere", "o", None, "general", None, is_system=True)

        _document(c, "d-photo", "o", "f1")
        _reference(c, "facility_photos", "o", "1", "d-photo")
        _document(c, "d-doc", "o", "f1")
        _reference(c, "facility_documents", "o", "1", "d-doc")
        _document(c, "d-loose", "o", "f1")
        # Another department's photo row naming the same id must not count.
        _reference(c, "facility_photos", "other-org", "1", "d-loose")
        _document(c, "d-maint", "o", "f1-maintenance")
        _document(c, "d-record-in-maint", "o", "f1-maintenance")
        _reference(c, "facility_documents", "o", "1", "d-record-in-maint")
        _document(c, "d-root-photo", "o", "root")
        _reference(c, "facility_photos", "o", "2", "d-root-photo")
        _document(c, "d-root-loose", "o", "root")
        _document(c, "d-elsewhere", "o", "elsewhere")
        _reference(c, "facility_documents", "o", "1", "d-elsewhere")
    return engine


def _perms_of(engine, folder_id):
    with engine.begin() as c:
        value = c.execute(
            sa.text("SELECT required_permissions FROM document_folders WHERE id = :i"),
            {"i": folder_id},
        ).scalar()
    return json.loads(value) if value else None


def _folder_of(engine, document_id):
    with engine.begin() as c:
        return c.execute(
            sa.text(
                "SELECT f.slug FROM documents d JOIN document_folders f "
                "ON f.id = d.folder_id WHERE d.id = :i"
            ),
            {"i": document_id},
        ).scalar()


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


def test_the_operational_part_of_the_tree_opens_and_the_rest_stays_shut(tree):
    _run(tree)

    for folder_id in ("root", "f1", "f2", "f1-photos", "f1-maintenance"):
        assert _perms_of(tree, folder_id) == ACCESS, folder_id
    assert _perms_of(tree, "f1-inspections") == ACCESS
    for sub in ("blueprints-permits", "insurance-leases", "capital-projects"):
        assert _perms_of(tree, f"f1-{sub}") == SENSITIVE, sub
    # Folders somebody made inside the tree were shut by inheritance; they
    # keep that, explicitly.
    assert _perms_of(tree, "custom") == SENSITIVE
    assert _perms_of(tree, "custom-in-photos") == SENSITIVE
    assert _perms_of(tree, "elsewhere") is None


def test_no_file_is_left_where_it_would_open_to_someone_new(tree):
    _run(tree)

    assert _folder_of(tree, "d-photo") == "facility-1-photos"
    assert _folder_of(tree, "d-doc") == "facility-1-documents"
    assert _folder_of(tree, "d-loose") == "facility-1-documents"
    assert _folder_of(tree, "d-record-in-maint") == "facility-1-documents"
    assert _folder_of(tree, "d-maint") == "facility-1-maintenance"
    assert _folder_of(tree, "d-root-photo") == "facility-2-photos"
    assert _folder_of(tree, "d-root-loose") == "facilities-restricted"
    assert _folder_of(tree, "d-elsewhere") == "general"

    with tree.begin() as c:
        created = dict(
            c.execute(
                sa.text(
                    "SELECT slug, required_permissions FROM document_folders "
                    "WHERE slug IN ('facility-1-documents', 'facility-2-photos', "
                    "'facilities-restricted')"
                )
            ).all()
        )
    assert json.loads(created["facility-1-documents"]) == SENSITIVE
    assert json.loads(created["facility-2-photos"]) == ACCESS
    assert json.loads(created["facilities-restricted"]) == SENSITIVE


def test_running_it_twice_changes_nothing_more(tree):
    _run(tree)
    first = _snapshot(tree)
    _run(tree)
    assert _snapshot(tree) == first


def test_the_downgrade_puts_everything_back(tree):
    before = _snapshot(tree)
    _run(tree)
    _run(tree, "downgrade")

    folders, documents = _snapshot(tree)
    before_folders, before_documents = before
    assert documents == before_documents
    assert [(i, p, s) for i, p, s, _ in folders] == [
        (i, p, s) for i, p, s, _ in before_folders
    ]
    assert {i: json.loads(p) if p else None for i, _, _, p in folders} == {
        i: json.loads(p) if p else None for i, _, _, p in before_folders
    }
    with tree.begin() as c:
        tables = set(sa.inspect(c).get_table_names())
    assert "facility_folder_tier_backfill" not in tables
    assert "facility_document_refile_backfill" not in tables


def test_a_database_without_the_tables_is_left_alone():
    database = sa.create_engine("sqlite://")
    try:
        _run(database)
        _run(database, "downgrade")
    finally:
        database.dispose()
