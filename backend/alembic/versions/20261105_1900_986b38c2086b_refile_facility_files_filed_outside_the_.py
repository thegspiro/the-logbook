"""Refile facility files filed outside the facility folders (FAC-13, 2026-11-01)

FAC-13's refile (``65128d5ccd50``) settled every file inside the Facility Files
tree. It left one case alone: a file a facility photo or facility document
points at that sits somewhere *outside* that facility's folders — in General
Documents, a member's folder, a library folder, another facility's folders, or
no folder at all. Such a file was governed by wherever it happened to sit, not
by the facility record that points at it, and ``GET /documents/{id}/download``
authorizes on the folder alone. The owner chose to move them (2026-11-01).

What this does, for every such file:

- A file any facility *document* points at moves to that facility's restricted
  **Facility Documents** sub-folder (the sensitive tier, like the record).
- A file only facility *photos* point at moves to that facility's **Photos**
  (any facilities access, like the photo record).
- A missing Facility Files root, facility folder or sub-folder is created the
  way ``DocumentsService.ensure_facility_folder`` /
  ``ensure_facility_sub_folder`` would on the day this was written: a new
  facility folder gets all seven standard sub-folders.

Decisions, and what each costs:

- **A file already anywhere in one of its own facilities' trees stays.** Tiers
  inside the tree were settled by ``65128d5ccd50`` and by the write path.
- **A file a facility points at that another module also owns stays where it
  is.** "Owns" means an apparatus photo or document, a purchase-request or
  expense receipt, or published meeting minutes points at it, or its
  ``source_type`` names a module other than facilities. Moving it behind
  facility rights would take it away from that module's audience — a vehicle
  document vanishing for apparatus officers because a station's record also
  links it — and that module's folder is a legitimate home for it. The cost:
  such a file stays governed by that module's folder, not by the facility
  record. ``docs/KNOWN_LIMITATIONS.md`` (FAC-13) records it.
- **A file two facilities point at goes to one of them** — the facility whose
  reference is oldest (by ``uploaded_at``, then reference id), among the
  references that decide its sub-folder. Every facility folder carries the
  same organization-wide permission tiers, so picking one does not change who
  can open it; the other facility's record still links to the same document.
  If either facility files it as a *document*, it goes to Facility Documents:
  the stricter tier wins, so a baseline ``facilities.view`` holder who saw it
  as a photo of the other facility can no longer download it. That is the
  fail-closed direction ``65128d5ccd50`` took for the same conflict.
- **An unfiled file (no folder) moves too.** A folderless document is
  organization-level, the widest exposure of all.

Who sees what changes: a moved file is no longer readable by the audience of
the folder it left (for General Documents, anyone holding ``documents.view``)
unless they hold facilities access. See ``docs/UPGRADING.md``.

Every move and every created folder is recorded in
``facility_outside_refile_backfill``, created only when there is something to
record — so a database with no such files is left without the table, rather
than reintroducing the upgrade-only bookkeeping ``d75ecbc15bae`` removed. The
downgrade moves a recorded file back only while it is still where this put
it, deletes a folder this created once it is empty (children first), and
drops the record. A re-run finds every file already in its facility's tree
and changes nothing.

Values (permission lists, folder fields) are inlined rather than imported: a
migration must keep doing what it did on the day it ran. Every step is skipped
when a table it needs is absent.

Revision ID: 986b38c2086b
Revises: 2bb7c963f351
Create Date: 2026-11-05 19:00:00.000000

"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "986b38c2086b"
down_revision: Union[str, None] = "2bb7c963f351"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module constants so a test can point the migration at scratch copies.
FOLDERS = "document_folders"
DOCUMENTS = "documents"
FACILITIES = "facilities"
PHOTOS = "facility_photos"
FACILITY_DOCUMENTS = "facility_documents"
RECORD = "facility_outside_refile_backfill"
# Other modules' pointers at a document: a file one of these names is owned
# by that module and stays where it is.
OTHER_OWNERS = (
    ("apparatus_photos", "document_id"),
    ("apparatus_documents", "document_id"),
    ("purchase_requests", "receipt_document_id"),
    ("expense_line_items", "receipt_document_id"),
    ("meeting_minutes", "published_document_id"),
)
FACILITY_SOURCE_TYPES = {"facility_photo", "facility_document"}

ACCESS = [
    "facilities.view",
    "facilities.view_sensitive",
    "facilities.edit",
    "facilities.manage",
]
SENSITIVE = ["facilities.view_sensitive", "facilities.edit", "facilities.manage"]

_ROOT = {
    "slug": "facilities",
    "name": "Facility Files",
    "description": "Per-facility folders with categorized sub-folders",
    "sort_order": 9,
    "icon": "building",
    "color": "text-indigo-400",
}
# FACILITY_SUB_FOLDERS as of 2026-11-05, in creation order.
_SUB_FOLDERS = {
    "photos": {
        "sensitive": False,
        "name": "Photos",
        "description": "Building exterior, interior, and detail photos",
        "sort_order": 0,
        "icon": "camera",
        "color": "text-sky-400",
    },
    "blueprints-permits": {
        "sensitive": True,
        "name": "Blueprints & Permits",
        "description": "Floor plans, blueprints, and building permits",
        "sort_order": 1,
        "icon": "map",
        "color": "text-blue-400",
    },
    "maintenance": {
        "sensitive": False,
        "name": "Maintenance Records",
        "description": "Work orders, service reports, and repair records",
        "sort_order": 2,
        "icon": "wrench",
        "color": "text-amber-400",
    },
    "inspections": {
        "sensitive": False,
        "name": "Inspection Reports",
        "description": "Building inspections and compliance reports",
        "sort_order": 3,
        "icon": "clipboard-check",
        "color": "text-green-400",
    },
    "insurance-leases": {
        "sensitive": True,
        "name": "Insurance & Leases",
        "description": "Insurance policies, lease agreements, and property documents",
        "sort_order": 4,
        "icon": "shield",
        "color": "text-red-400",
    },
    "capital-projects": {
        "sensitive": True,
        "name": "Capital Projects",
        "description": "Renovation plans, bids, and project documents",
        "sort_order": 5,
        "icon": "hard-hat",
        "color": "text-orange-400",
    },
    "documents": {
        "sensitive": True,
        "name": "Facility Documents",
        "description": "Files attached to the facility's Documents list",
        "sort_order": 6,
        "icon": "file-text",
        "color": "text-indigo-400",
    },
}


def _inspector():
    return sa.inspect(op.get_bind())


def _columns(table: str) -> set:
    return {c["name"] for c in _inspector().get_columns(table)}


class _Record:
    """The bookkeeping table, created on first write."""

    def __init__(self, bind, tables: set):
        self.bind = bind
        self.exists = RECORD in tables

    def _ensure(self) -> None:
        if self.exists:
            return
        op.create_table(
            RECORD,
            sa.Column("seq", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("kind", sa.String(10), nullable=False),
            sa.Column("item_id", sa.String(36), nullable=False),
            sa.Column("from_folder_id", sa.String(36), nullable=True),
            sa.Column("to_folder_id", sa.String(36), nullable=True),
        )
        self.exists = True

    def add(self, kind: str, item_id: str, from_id, to_id) -> None:
        self._ensure()
        self.bind.execute(
            sa.text(
                f"INSERT INTO {RECORD} (kind, item_id, from_folder_id, to_folder_id) "
                "VALUES (:kind, :item, :from_id, :to_id)"
            ),
            {"kind": kind, "item": item_id, "from_id": from_id, "to_id": to_id},
        )


class _Tree:
    """One organization's folders, loaded once, edited in step with the DB."""

    def __init__(self, bind, organization_id: str, record: _Record):
        self.bind = bind
        self.organization_id = organization_id
        self.record = record
        rows = bind.execute(
            sa.text(
                f"SELECT id, parent_id, slug, is_system FROM {FOLDERS} "
                "WHERE organization_id = :org"
            ),
            {"org": organization_id},
        ).all()
        self.folders = {
            str(r.id): {
                "id": str(r.id),
                "parent_id": str(r.parent_id) if r.parent_id else None,
                "slug": r.slug or "",
                "is_system": bool(r.is_system),
            }
            for r in rows
        }

    def roots(self) -> list:
        return sorted(
            (
                f
                for f in self.folders.values()
                if f["slug"] == _ROOT["slug"] and f["is_system"] and not f["parent_id"]
            ),
            key=lambda f: f["id"],
        )

    def child(self, parent_id: str, slug: str) -> Optional[dict]:
        matches = sorted(
            (
                f
                for f in self.folders.values()
                if f["parent_id"] == parent_id and f["slug"] == slug
            ),
            key=lambda f: f["id"],
        )
        return matches[0] if matches else None

    def facility_of(self, folder_id: Optional[str]) -> set:
        """The facility ids whose tree holds *folder_id* (any root)."""
        root_ids = {f["id"] for f in self.roots()}
        seen = set()
        current = self.folders.get(folder_id) if folder_id else None
        while current is not None and current["id"] not in seen:
            seen.add(current["id"])
            if current["parent_id"] in root_ids and current["slug"].startswith(
                "facility-"
            ):
                return {current["slug"][len("facility-") :]}
            current = self.folders.get(current["parent_id"] or "")
        return set()

    def _create(
        self, parent: Optional[dict], slug: str, fields: dict, perms, is_system
    ) -> dict:
        folder_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        self.bind.execute(
            sa.text(
                f"INSERT INTO {FOLDERS} (id, organization_id, parent_id, name, slug, "
                "description, icon, color, sort_order, visibility, "
                "required_permissions, is_system, created_at, updated_at) VALUES "
                "(:id, :org, :parent, :name, :slug, :description, :icon, :color, "
                ":sort_order, 'organization', :perms, :is_system, :now, :now)"
            ),
            {
                "id": folder_id,
                "org": self.organization_id,
                "parent": parent["id"] if parent else None,
                "name": fields["name"][:255],
                "slug": slug,
                "description": fields.get("description"),
                "icon": fields["icon"],
                "color": fields["color"],
                "sort_order": fields["sort_order"],
                "perms": json.dumps(perms),
                "is_system": is_system,
                "now": now,
            },
        )
        self.record.add("folder", folder_id, None, None)
        folder = {
            "id": folder_id,
            "parent_id": parent["id"] if parent else None,
            "slug": slug,
            "is_system": is_system,
        }
        self.folders[folder_id] = folder
        return folder

    def _sub(self, facility_folder: dict, suffix: str) -> dict:
        fields = _SUB_FOLDERS[suffix]
        return self._create(
            facility_folder,
            f"{facility_folder['slug']}-{suffix}",
            fields,
            SENSITIVE if fields["sensitive"] else ACCESS,
            False,
        )

    def sub_folder(self, facility_id: str, facility_name: str, suffix: str) -> dict:
        roots = self.roots()
        root = (
            roots[0]
            if roots
            else self._create(None, _ROOT["slug"], _ROOT, ACCESS, True)
        )
        facility_slug = f"facility-{facility_id}"
        facility_folder = self.child(root["id"], facility_slug)
        if facility_folder is None:
            facility_folder = self._create(
                root,
                facility_slug,
                {
                    "name": facility_name or facility_slug,
                    "description": None,
                    "icon": "building",
                    "color": "text-indigo-400",
                    "sort_order": 0,
                },
                ACCESS,
                False,
            )
            for name in _SUB_FOLDERS:
                self._sub(facility_folder, name)
        existing = self.child(facility_folder["id"], f"{facility_slug}-{suffix}")
        return existing if existing is not None else self._sub(facility_folder, suffix)


def _reference_rows(bind, tables: set, table: str, has_source_type: bool) -> list:
    if table not in tables:
        return []
    order = "r.uploaded_at" if "uploaded_at" in _columns(table) else "NULL"
    source = "d.source_type" if has_source_type else "NULL"
    return bind.execute(
        sa.text(
            f"SELECT r.id AS ref_id, r.organization_id AS org, r.facility_id, "
            f"r.document_id, {order} AS referenced_at, f.name AS facility_name, "
            f"d.folder_id, {source} AS source_type "
            f"FROM {table} r "
            f"JOIN {FACILITIES} f ON f.id = r.facility_id "
            "AND f.organization_id = r.organization_id "
            f"JOIN {DOCUMENTS} d ON d.id = r.document_id "
            "AND d.organization_id = r.organization_id "
            "WHERE r.document_id IS NOT NULL"
        )
    ).all()


def _owned_elsewhere(bind, tables: set) -> set:
    owned = set()
    for table, column in OTHER_OWNERS:
        if table not in tables or column not in _columns(table):
            continue
        owned.update(
            str(r[0])
            for r in bind.execute(
                sa.text(f"SELECT {column} FROM {table} WHERE {column} IS NOT NULL")
            )
        )
    return owned


def _oldest(refs: list) -> dict:
    return sorted(
        refs,
        key=lambda r: (
            r["referenced_at"] is None,
            r["referenced_at"] or "",
            r["ref_id"],
        ),
    )[0]


def upgrade() -> None:
    tables = set(_inspector().get_table_names())
    if not {FOLDERS, DOCUMENTS, FACILITIES} <= tables:
        return
    bind = op.get_bind()
    has_source_type = "source_type" in _columns(DOCUMENTS)

    # {(org, document_id): {"folder_id", "source_type", "refs": [...]}}
    files: dict = {}
    for table, kind in ((FACILITY_DOCUMENTS, "documents"), (PHOTOS, "photos")):
        for row in _reference_rows(bind, tables, table, has_source_type):
            entry = files.setdefault(
                (str(row.org), str(row.document_id)),
                {
                    "folder_id": str(row.folder_id) if row.folder_id else None,
                    "source_type": row.source_type,
                    "refs": [],
                },
            )
            entry["refs"].append(
                {
                    "kind": kind,
                    "ref_id": str(row.ref_id),
                    "facility_id": str(row.facility_id),
                    "facility_name": row.facility_name,
                    "referenced_at": row.referenced_at,
                }
            )
    if not files:
        return

    owned = _owned_elsewhere(bind, tables)
    record = _Record(bind, tables)
    trees: dict = {}
    for (org, document_id), entry in sorted(files.items()):
        if document_id in owned:
            continue
        source_type = entry["source_type"]
        if source_type and source_type not in FACILITY_SOURCE_TYPES:
            continue
        if org not in trees:
            trees[org] = _Tree(bind, org, record)
        tree = trees[org]
        referencing = {r["facility_id"] for r in entry["refs"]}
        if tree.facility_of(entry["folder_id"]) & referencing:
            continue
        documents = [r for r in entry["refs"] if r["kind"] == "documents"]
        suffix = "documents" if documents else "photos"
        chosen = _oldest(documents or entry["refs"])
        target = tree.sub_folder(chosen["facility_id"], chosen["facility_name"], suffix)
        bind.execute(
            sa.text(f"UPDATE {DOCUMENTS} SET folder_id = :to WHERE id = :id"),
            {"to": target["id"], "id": document_id},
        )
        record.add("document", document_id, entry["folder_id"], target["id"])


def downgrade() -> None:
    tables = set(_inspector().get_table_names())
    if RECORD not in tables:
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"SELECT seq, kind, item_id, from_folder_id, to_folder_id FROM {RECORD} "
            "ORDER BY seq"
        )
    ).all()
    if DOCUMENTS in tables:
        for row in rows:
            if row.kind != "document":
                continue
            bind.execute(
                sa.text(
                    f"UPDATE {DOCUMENTS} SET folder_id = :from_id "
                    "WHERE id = :id AND folder_id = :to_id"
                ),
                {
                    "from_id": row.from_folder_id,
                    "id": row.item_id,
                    "to_id": row.to_folder_id,
                },
            )
    if FOLDERS in tables and DOCUMENTS in tables:
        # Newest first, so a sub-folder goes before the folder that holds it.
        for row in reversed(rows):
            if row.kind != "folder":
                continue
            occupied = bind.execute(
                sa.text(
                    f"SELECT (SELECT COUNT(*) FROM {DOCUMENTS} WHERE folder_id = :id)"
                    f" + (SELECT COUNT(*) FROM {FOLDERS} WHERE parent_id = :id)"
                ),
                {"id": row.item_id},
            ).scalar()
            if not occupied:
                bind.execute(
                    sa.text(f"DELETE FROM {FOLDERS} WHERE id = :id"),
                    {"id": row.item_id},
                )
    op.execute(f"DROP TABLE IF EXISTS {RECORD}")
