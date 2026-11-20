"""Every column that names a stored file is listed by ``collect_references``,
or allowlisted here with a reason.

``upload_relocation.collect_references`` is the one list of stored-file
references. ``member_files.referenced_elsewhere`` reads it to decide whether a
file another row still names may be deleted, and the relocation and
remote-bucket migrations read it to move every file. A file column it does not
list is a file those all miss: a member erasure deletes a certificate that
column still needs, or a migration leaves the file behind.

Scope, and its limits
---------------------
A column counts as file-bearing by its name and type, nothing else:

- a ``String``/``Text`` column named ``file_path``, ``storage_path`` or
  ``*_path``;
- a ``JSON`` column named ``attachments``, ``*_attachments`` or ``*_paths``.

So a file column named outside that convention is invisible to this test.
``*_url`` columns are out of scope: they hold external URLs, or data URIs kept
in the row itself (scanned by ``stored_file_rescan``). ``*_document_id``
foreign keys are covered through ``documents.file_path``, which is collected.

"Collected" means ``collect_references``' source mentions the column as
``MappedClass.attribute``. Any mention counts, a ``where`` clause included, so
the test proves a column is read there, not that each value becomes a
reference. A block that selects whole entities and reads ``row.file_path``
is not seen at all, and its column reports as uncovered: the test fails
closed, never open.
"""

import ast
import importlib
import inspect
from typing import Iterable

import sqlalchemy as sa

from app.core.database import Base
from app.services import upload_relocation
from app.services.file_storage_service import StorageArea

# Every mapper must be on Base before the metadata is walked.
importlib.import_module("app.models")

# Columns whose names say "file" but which name no file the server stores.
NOT_COLLECTED: dict[tuple[str, str], str] = {
    # A ``document:<id>`` reference (or a legacy URL). The file belongs to the
    # documents row, collected as documents.file_path.
    ("apparatus_photos", "file_path"): "document:<id> reference",
    ("apparatus_documents", "file_path"): "document:<id> reference",
    ("facility_photos", "file_path"): "document:<id> reference",
    ("facility_documents", "file_path"): "document:<id> reference",
    # Client-supplied text: no server code writes a stored file's path into
    # it, resolves it or serves it.
    ("facility_shutoff_locations", "photo_path"): "client-supplied text",
    # Client-supplied reference metadata. No upload route stores a file into
    # these lists, and nothing server-side resolves or serves a file_path
    # from them.
    ("apparatus_maintenance", "attachments"): "client-supplied metadata",
    ("apparatus_component_notes", "attachments"): "client-supplied metadata",
    ("facility_maintenance", "attachments"): "client-supplied metadata",
    ("facility_inspections", "attachments"): "client-supplied metadata",
    ("facility_capital_projects", "attachments"): "client-supplied metadata",
    ("facility_insurance_policies", "attachments"): "client-supplied metadata",
    ("grant_compliance_tasks", "attachments"): "client-supplied metadata",
    ("inventory_items", "attachments"): "client-supplied metadata",
    ("maintenance_records", "attachments"): "client-supplied metadata",
}

# Columns the naming heuristic catches that are not files at all.
NOT_FILE_COLUMNS: dict[tuple[str, str], str] = {
    ("blocked_access_attempts", "request_path"): "the request's URL path",
    ("testing_checklist_entries", "route_path"): "a frontend route",
}


def _is_file_column(column: sa.Column) -> bool:
    name = column.name
    if isinstance(column.type, sa.Enum):
        return False
    if isinstance(column.type, (sa.String, sa.Text)):
        return name in ("file_path", "storage_path") or name.endswith("_path")
    if isinstance(column.type, sa.JSON):
        return (
            name == "attachments"
            or name.endswith("_attachments")
            or name.endswith("_paths")
        )
    return False


def _file_columns(tables: Iterable[sa.Table]) -> set[tuple[str, str]]:
    return {
        (table.name, column.name)
        for table in tables
        for column in table.columns
        if _is_file_column(column)
    }


def _mapped_columns() -> dict[tuple[str, str], set[tuple[str, str]]]:
    """(class name, attribute key) -> the (table, column) pairs it maps to."""
    found: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for mapper in Base.registry.mappers:
        for prop in mapper.column_attrs:
            for column in prop.columns:
                if isinstance(column, sa.Column) and column.table is not None:
                    key = (mapper.class_.__name__, prop.key)
                    found.setdefault(key, set()).add((column.table.name, column.name))
    return found


def _collect_function(source: str) -> ast.AsyncFunctionDef:
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "collect_references":
            return node
    raise AssertionError("collect_references not found")


def _collected_columns(source: str) -> set[tuple[str, str]]:
    mapped = _mapped_columns()
    collected: set[tuple[str, str]] = set()
    for node in ast.walk(_collect_function(source)):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            collected |= mapped.get((node.value.id, node.attr), set())
    return collected


def _collected_areas(source: str) -> set[str]:
    return {
        node.attr
        for node in ast.walk(_collect_function(source))
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Name)
        and node.value.id == "StorageArea"
    }


def _source() -> str:
    return inspect.getsource(upload_relocation)


def _uncovered(source: str, tables: Iterable[sa.Table]) -> set[tuple[str, str]]:
    return (
        _file_columns(tables)
        - _collected_columns(source)
        - set(NOT_COLLECTED)
        - set(NOT_FILE_COLUMNS)
    )


def test_every_file_column_is_collected_or_allowlisted():
    uncovered = _uncovered(_source(), Base.metadata.tables.values())
    assert not uncovered, (
        "These columns look like they name a stored file, but "
        "upload_relocation.collect_references does not list them, so a member "
        "erasure's reference check and the storage migrations cannot see "
        "them. Collect them there, or allowlist them in this test with the "
        f"reason they name no stored file: {sorted(uncovered)}"
    )


def test_allowlists_have_no_stale_entries():
    files = _file_columns(Base.metadata.tables.values())
    collected = _collected_columns(_source())
    for entry in {**NOT_COLLECTED, **NOT_FILE_COLUMNS}:
        assert entry in files, f"{entry} no longer exists or no longer matches"
        assert entry not in collected, f"{entry} is collected; drop it from the list"


def test_the_allowlists_do_not_overlap():
    assert not set(NOT_COLLECTED) & set(NOT_FILE_COLUMNS)


def test_every_storage_area_is_collected():
    missing = {area.name for area in StorageArea} - _collected_areas(_source())
    assert not missing, f"No reference names these storage areas: {sorted(missing)}"


class TestTheDetectionItself:
    """Proves each half of the check can fail."""

    def _table(self, *columns: sa.Column) -> sa.Table:
        return sa.Table(
            "probe", sa.MetaData(), sa.Column("id", sa.String(36)), *columns
        )

    def test_the_heuristic_flags_paths_and_attachment_lists(self):
        table = self._table(
            sa.Column("scan_path", sa.String(500)),
            sa.Column("attachments", sa.JSON),
            sa.Column("photo_url", sa.String(500)),
            sa.Column("evidence_paths", sa.JSON),
        )
        assert _file_columns([table]) == {
            ("probe", "scan_path"),
            ("probe", "attachments"),
            ("probe", "evidence_paths"),
        }

    def test_a_collected_column_is_found(self):
        source = (
            "async def collect_references(db, organization_id):\n"
            "    select(MinutesAttachment.id, MinutesAttachment.file_path)\n"
        )
        assert ("minutes_attachments", "file_path") in _collected_columns(source)

    def test_a_column_left_out_is_reported(self):
        source = (
            "async def collect_references(db, organization_id):\n"
            "    select(Document.id, Document.file_path)\n"
        )
        tables = [
            Base.metadata.tables["minutes_attachments"],
            Base.metadata.tables["documents"],
        ]
        assert _uncovered(source, tables) == {("minutes_attachments", "file_path")}

    def test_a_whole_entity_read_fails_closed(self):
        source = (
            "async def collect_references(db, organization_id):\n"
            "    for row in (await db.execute(select(MinutesAttachment))).scalars():\n"
            "        refs.append(row.file_path)\n"
        )
        tables = [Base.metadata.tables["minutes_attachments"]]
        assert _uncovered(source, tables) == {("minutes_attachments", "file_path")}

    def test_a_missing_area_is_reported(self):
        source = (
            "async def collect_references(db, organization_id):\n"
            "    Reference(StorageArea.DOCUMENTS)\n"
        )
        assert _collected_areas(source) == {"DOCUMENTS"}
