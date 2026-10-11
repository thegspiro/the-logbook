"""Open the operational facility folders to any facilities access (FAC-13)

Every folder in the facility file tree was stamped with the sensitive set
(``facilities.view_sensitive``/``edit``/``manage``), and folder access ANDs
every ancestor — so the secretary, quartermaster, safety and training officers,
who hold baseline ``facilities.view`` by design, saw no facility folder at all,
not even Photos. The owner chose a new "any facilities access" tier for the
operational part of the tree, with Blueprints & Permits staying sensitive.

What this does, per organization's Facility Files root:

1. **Restamps.** The root, each facility's own folder, and its Photos,
   Maintenance Records and Inspection Reports sub-folders get the any-access
   tier. Blueprints & Permits, Insurance & Leases, Capital Projects and
   Facility Documents keep (or are given) the sensitive tier. Any other folder
   in the tree with no permissions of its own — one somebody created inside
   it — is given the sensitive tier, because until now it was protected by its
   sensitive ancestors and is about to stop being.
2. **Refiles documents first, so nothing becomes readable by someone new**
   except what the decision opens. A file sitting directly in the root or in a
   facility's own folder was sensitive by inheritance:
   - one a facility photo points at moves to that facility's Photos (photo
     records are baseline, so this is the intended audience);
   - one a facility document points at, or that nothing points at, moves to
     that facility's restricted **Facility Documents** sub-folder;
   - one directly in the root with no facility to file under moves to a
     restricted **Restricted Facility Files** folder under the root.
   A file a facility *document* points at that sits in Photos, Maintenance
   Records or Inspection Reports also moves to Facility Documents — those
   records are sensitive, and their files must not be readable more widely.
   A missing sub-folder is created. Files filed anywhere else are untouched.

Every restamp, move and created folder is recorded in
``facility_folder_tier_backfill`` / ``facility_document_refile_backfill``.
The downgrade moves a recorded document back only while it is still where
this put it, restores each recorded folder's previous permissions, deletes a
folder this created if it is empty, and drops the records.

Values (permission lists, sub-folder fields) are inlined rather than imported,
because a migration must keep doing what it did on the day it ran. Every step
is skipped when a table is absent.

Revision ID: 65128d5ccd50
Revises: e6d21e605d99
Create Date: 2026-10-11 23:40:00.000000

"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "65128d5ccd50"
down_revision: Union[str, None] = "e6d21e605d99"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module constants so a test can point the migration at scratch copies.
FOLDERS = "document_folders"
DOCUMENTS = "documents"
PHOTOS = "facility_photos"
FACILITY_DOCUMENTS = "facility_documents"
TIER_RECORD = "facility_folder_tier_backfill"
REFILE_RECORD = "facility_document_refile_backfill"

ACCESS = [
    "facilities.view",
    "facilities.view_sensitive",
    "facilities.edit",
    "facilities.manage",
]
SENSITIVE = ["facilities.view_sensitive", "facilities.edit", "facilities.manage"]

# Sub-folder slug suffix -> its tier, and the fields used if it must be created.
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
_BASELINE_SUBS = {slug for slug, d in _SUB_FOLDERS.items() if not d["sensitive"]}
_RESTRICTED_ROOT_CHILD = {
    "slug": "facilities-restricted",
    "name": "Restricted Facility Files",
    "description": "Files that were filed directly in Facility Files",
    "sort_order": 99,
    "icon": "lock",
    "color": "text-red-400",
}


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _perms(value) -> list:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return list(value) if isinstance(value, list) else []


def _ensure_record_tables(tables: set) -> None:
    if TIER_RECORD not in tables:
        op.create_table(
            TIER_RECORD,
            sa.Column("folder_id", sa.String(36), primary_key=True),
            sa.Column("previous_permissions", sa.Text(), nullable=True),
            sa.Column("created_here", sa.Boolean(), nullable=False),
        )
    if REFILE_RECORD not in tables:
        op.create_table(
            REFILE_RECORD,
            sa.Column("document_id", sa.String(36), primary_key=True),
            sa.Column("from_folder_id", sa.String(36), nullable=False),
            sa.Column("to_folder_id", sa.String(36), nullable=False),
        )


class _Tree:
    """The organization's folders, loaded once, edited in step with the DB."""

    def __init__(self, bind, organization_id: str):
        self.bind = bind
        self.organization_id = organization_id
        rows = bind.execute(
            sa.text(
                f"SELECT id, parent_id, slug, required_permissions, is_system "
                f"FROM {FOLDERS} WHERE organization_id = :org"
            ),
            {"org": organization_id},
        ).all()
        self.folders = {
            str(r.id): {
                "id": str(r.id),
                "parent_id": str(r.parent_id) if r.parent_id else None,
                "slug": r.slug,
                "perms": _perms(r.required_permissions),
                "is_system": bool(r.is_system),
            }
            for r in rows
        }
        self.recorded = {
            str(r[0])
            for r in bind.execute(sa.text(f"SELECT folder_id FROM {TIER_RECORD}"))
        }

    def children(self, folder_id: str) -> list:
        return [f for f in self.folders.values() if f["parent_id"] == folder_id]

    def child(self, folder_id: str, slug: str) -> Optional[dict]:
        matches = sorted(
            (f for f in self.children(folder_id) if f["slug"] == slug),
            key=lambda f: f["id"],
        )
        return matches[0] if matches else None

    def stamp(self, folder: dict, perms: list) -> None:
        if folder["perms"] == perms:
            return
        if folder["id"] not in self.recorded:
            self.bind.execute(
                sa.text(
                    f"INSERT INTO {TIER_RECORD} "
                    "(folder_id, previous_permissions, created_here) "
                    "VALUES (:id, :prev, :created)"
                ),
                {
                    "id": folder["id"],
                    "prev": json.dumps(folder["perms"]) if folder["perms"] else None,
                    "created": False,
                },
            )
            self.recorded.add(folder["id"])
        self.bind.execute(
            sa.text(f"UPDATE {FOLDERS} SET required_permissions = :p WHERE id = :id"),
            {"p": json.dumps(perms), "id": folder["id"]},
        )
        folder["perms"] = list(perms)

    def create(self, parent: dict, slug: str, fields: dict, perms: list) -> dict:
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
                "parent": parent["id"],
                "name": fields["name"],
                "slug": slug,
                "description": fields["description"],
                "icon": fields["icon"],
                "color": fields["color"],
                "sort_order": fields["sort_order"],
                "perms": json.dumps(perms),
                "is_system": False,
                "now": now,
            },
        )
        self.bind.execute(
            sa.text(
                f"INSERT INTO {TIER_RECORD} "
                "(folder_id, previous_permissions, created_here) "
                "VALUES (:id, NULL, :created)"
            ),
            {"id": folder_id, "created": True},
        )
        self.recorded.add(folder_id)
        folder = {
            "id": folder_id,
            "parent_id": parent["id"],
            "slug": slug,
            "perms": list(perms),
            "is_system": False,
        }
        self.folders[folder_id] = folder
        return folder

    def sub_folder(self, facility_folder: dict, suffix: str) -> dict:
        slug = f"{facility_folder['slug']}-{suffix}"
        existing = self.child(facility_folder["id"], slug)
        if existing is not None:
            return existing
        fields = _SUB_FOLDERS[suffix]
        return self.create(
            facility_folder, slug, fields, SENSITIVE if fields["sensitive"] else ACCESS
        )


def _references(bind, table: str, tables: set, organization_id: str) -> dict:
    """{document_id: facility_id} for one reference table, or {} if absent."""
    if table not in tables:
        return {}
    rows = bind.execute(
        sa.text(
            f"SELECT document_id, facility_id FROM {table} "
            "WHERE organization_id = :org AND document_id IS NOT NULL"
        ),
        {"org": organization_id},
    ).all()
    return {str(r.document_id): str(r.facility_id) for r in rows}


def _refile(bind, document_id: str, from_id: str, to_id: str) -> None:
    bind.execute(
        sa.text(f"UPDATE {DOCUMENTS} SET folder_id = :to WHERE id = :id"),
        {"to": to_id, "id": document_id},
    )
    # A re-run keeps the first-recorded origin: that is where a downgrade
    # should return the document to.
    recorded = bind.execute(
        sa.text(f"SELECT 1 FROM {REFILE_RECORD} WHERE document_id = :id"),
        {"id": document_id},
    ).first()
    if recorded:
        bind.execute(
            sa.text(
                f"UPDATE {REFILE_RECORD} SET to_folder_id = :to_id "
                "WHERE document_id = :id"
            ),
            {"id": document_id, "to_id": to_id},
        )
    else:
        bind.execute(
            sa.text(
                f"INSERT INTO {REFILE_RECORD} "
                "(document_id, from_folder_id, to_folder_id) "
                "VALUES (:id, :from_id, :to_id)"
            ),
            {"id": document_id, "from_id": from_id, "to_id": to_id},
        )


def _upgrade_root(bind, tables: set, tree: _Tree, root: dict) -> None:
    facility_folders = [
        f
        for f in tree.children(root["id"])
        if (f["slug"] or "").startswith("facility-")
    ]
    by_facility_slug = {f["slug"]: f for f in facility_folders}
    standard = {root["id"]}

    # 2. Refile first, while every folder still carries its old stamp.
    photo_refs = _references(bind, PHOTOS, tables, tree.organization_id)
    document_refs = _references(bind, FACILITY_DOCUMENTS, tables, tree.organization_id)
    baseline_subs = {}
    for facility_folder in facility_folders:
        for suffix in _BASELINE_SUBS:
            sub = tree.child(
                facility_folder["id"], f"{facility_folder['slug']}-{suffix}"
            )
            if sub is not None:
                baseline_subs[sub["id"]] = facility_folder
    watched = [root["id"]] + [f["id"] for f in facility_folders] + list(baseline_subs)
    placeholders = ", ".join(f":f{i}" for i in range(len(watched)))
    documents = bind.execute(
        sa.text(
            f"SELECT id, folder_id FROM {DOCUMENTS} "
            f"WHERE folder_id IN ({placeholders})"
        ),
        {f"f{i}": folder_id for i, folder_id in enumerate(watched)},
    ).all()
    restricted = None
    for row in documents:
        document_id, folder_id = str(row.id), str(row.folder_id)
        target = None
        if folder_id in baseline_subs:
            if document_id in document_refs:
                target = tree.sub_folder(baseline_subs[folder_id], "documents")
        else:
            facility_folder = (
                tree.folders[folder_id] if folder_id != root["id"] else None
            )
            if facility_folder is None:
                facility_id = document_refs.get(document_id) or photo_refs.get(
                    document_id
                )
                facility_folder = (
                    by_facility_slug.get(f"facility-{facility_id}")
                    if facility_id
                    else None
                )
            if facility_folder is not None:
                suffix = (
                    "photos"
                    if document_id in photo_refs and document_id not in document_refs
                    else "documents"
                )
                target = tree.sub_folder(facility_folder, suffix)
            else:
                if restricted is None:
                    slug = _RESTRICTED_ROOT_CHILD["slug"]
                    restricted = tree.child(root["id"], slug) or tree.create(
                        root, slug, _RESTRICTED_ROOT_CHILD, SENSITIVE
                    )
                target = restricted
        if target is not None and target["id"] != folder_id:
            _refile(bind, document_id, folder_id, target["id"])

    # 1. Restamp.
    tree.stamp(root, ACCESS)
    for facility_folder in facility_folders:
        standard.add(facility_folder["id"])
        tree.stamp(facility_folder, ACCESS)
        for suffix, fields in _SUB_FOLDERS.items():
            sub = tree.child(
                facility_folder["id"], f"{facility_folder['slug']}-{suffix}"
            )
            if sub is not None:
                standard.add(sub["id"])
                tree.stamp(sub, SENSITIVE if fields["sensitive"] else ACCESS)
    # Anything else in the tree with no gate of its own stays sensitive.
    pending = [root["id"]]
    while pending:
        for child in tree.children(pending.pop()):
            pending.append(child["id"])
            if child["id"] not in standard and not child["perms"]:
                tree.stamp(child, SENSITIVE)


def upgrade() -> None:
    tables = _tables()
    if FOLDERS not in tables or DOCUMENTS not in tables:
        return
    _ensure_record_tables(tables)
    bind = op.get_bind()
    roots = bind.execute(
        sa.text(
            f"SELECT id, organization_id FROM {FOLDERS} "
            "WHERE slug = 'facilities' AND is_system = :true AND parent_id IS NULL"
        ),
        {"true": True},
    ).all()
    for root_row in roots:
        tree = _Tree(bind, str(root_row.organization_id))
        _upgrade_root(bind, tables, tree, tree.folders[str(root_row.id)])


def downgrade() -> None:
    tables = _tables()
    bind = op.get_bind()
    if REFILE_RECORD in tables and DOCUMENTS in tables:
        for row in bind.execute(
            sa.text(
                f"SELECT document_id, from_folder_id, to_folder_id FROM {REFILE_RECORD}"
            )
        ).all():
            bind.execute(
                sa.text(
                    f"UPDATE {DOCUMENTS} SET folder_id = :from_id "
                    "WHERE id = :id AND folder_id = :to_id"
                ),
                {
                    "from_id": row.from_folder_id,
                    "id": row.document_id,
                    "to_id": row.to_folder_id,
                },
            )
    if TIER_RECORD in tables and FOLDERS in tables:
        records = bind.execute(
            sa.text(
                f"SELECT folder_id, previous_permissions, created_here FROM {TIER_RECORD}"
            )
        ).all()
        for row in records:
            if not row.created_here:
                bind.execute(
                    sa.text(
                        f"UPDATE {FOLDERS} SET required_permissions = :p WHERE id = :id"
                    ),
                    {"p": row.previous_permissions, "id": row.folder_id},
                )
        for row in records:
            if not row.created_here:
                continue
            occupied = bind.execute(
                sa.text(
                    f"SELECT (SELECT COUNT(*) FROM {DOCUMENTS} WHERE folder_id = :id)"
                    f" + (SELECT COUNT(*) FROM {FOLDERS} WHERE parent_id = :id)"
                ),
                {"id": row.folder_id},
            ).scalar()
            if not occupied:
                bind.execute(
                    sa.text(f"DELETE FROM {FOLDERS} WHERE id = :id"),
                    {"id": row.folder_id},
                )
    op.execute(f"DROP TABLE IF EXISTS {REFILE_RECORD}")
    op.execute(f"DROP TABLE IF EXISTS {TIER_RECORD}")
