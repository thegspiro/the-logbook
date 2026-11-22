"""CRR activities: the activity log, its Admin Hours link, and the CRR grants.

Community risk reduction tracking, part 2 (owner decisions, 2026-11-22).

* Four new tables: ``crr_activities`` (resident details encrypted at rest),
  ``crr_activity_counts``, ``crr_activity_tags`` and ``crr_activity_members``.
* ``crr_activity_types`` gains a nullable ``admin_hours_category_id``. Every
  existing type reads NULL, which falls back to the department's Public
  Education mapping.
* ``admin_hours_entries.entry_method`` gains ``crr_activity``, and the table
  gains a nullable ``source_crr_activity_id``. Existing entries keep their
  values; none of them came from a CRR activity.
* Grants, to stored system positions (the registry change alone reaches only
  departments onboarded later, pitfall #23):

  - ``crr.record`` to every system position holding ``events.manage`` (or
    ``events.*``), and to the Community Outreach Team;
  - ``crr.view_contact`` to the Community Outreach Manager (``public_outreach``),
    the three chief positions and the president.

  A position a department created itself is left alone, per the seeded-grant
  rule; grant these on the positions screen if wanted. Granting is idempotent.

Every table and column step is guarded, so a database ``create_all`` already
built upgrades cleanly (pitfall #26). The downgrade revokes the two grants,
sets any ``crr_activity`` entry to ``manual`` (the nearest older meaning: hours
entered by a person) before narrowing the enum, drops the new column and the
four tables. The activities themselves are lost by a downgrade.

Revision ID: 5c2e8a417d90
Revises: 89c0b481fe55
Create Date: 2026-11-22 16:13:00.000000
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "5c2e8a417d90"
down_revision: Union[str, Sequence[str], None] = "89c0b481fe55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen at this revision, not imported from the registry.
# Each grant with the stored permissions that are evidence for it.
_EVIDENCE_GRANTS = (("crr.record", frozenset({"events.manage", "events.*"})),)
# Each grant with the system position slugs that receive it outright.
_SLUG_GRANTS = (
    ("crr.record", frozenset({"community_outreach_team"})),
    (
        "crr.view_contact",
        frozenset(
            {
                "public_outreach",
                "fire_chief",
                "deputy_chief",
                "assistant_chief",
                "president",
            }
        ),
    ),
)
_GRANTED = frozenset({"crr.record", "crr.view_contact"})

ENTRIES = "admin_hours_entries"
_OLD_METHODS = ("qr_scan", "nfc_station", "manual", "event_attendance", "import")
_NEW_METHODS = _OLD_METHODS + ("crr_activity",)

# Child before parent, for the downgrade.
_TABLES = (
    "crr_activity_members",
    "crr_activity_tags",
    "crr_activity_counts",
    "crr_activities",
)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _org_column() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _activity_fk(primary_key: bool = True) -> sa.Column:
    return sa.Column(
        "activity_id",
        sa.String(36),
        sa.ForeignKey("crr_activities.id", ondelete="CASCADE"),
        primary_key=primary_key,
    )


def _create_tables() -> None:
    if not _has_table("crr_activities"):
        op.create_table(
            "crr_activities",
            sa.Column("id", sa.String(36), primary_key=True),
            _org_column(),
            sa.Column(
                "activity_type_id",
                sa.String(36),
                sa.ForeignKey("crr_activity_types.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(36),
                sa.ForeignKey("events.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("zip_code", sa.String(10), nullable=True),
            sa.Column("city", sa.String(100), nullable=True),
            sa.Column("state", sa.String(50), nullable=True),
            sa.Column("county", sa.String(100), nullable=True),
            # EncryptedText columns are TEXT holding ciphertext.
            sa.Column("street_address", sa.Text(), nullable=True),
            sa.Column("resident_name", sa.Text(), nullable=True),
            sa.Column("resident_phone", sa.Text(), nullable=True),
            sa.Column("resident_email", sa.Text(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "resident_details_cleared_at", sa.DateTime(timezone=True), nullable=True
            ),
            sa.Column(
                "recorded_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_crr_activities_org_when",
            "crr_activities",
            ["organization_id", "occurred_at"],
        )
        op.create_index("ix_crr_activities_event", "crr_activities", ["event_id"])
        op.create_index(
            "ix_crr_activities_type", "crr_activities", ["activity_type_id"]
        )

    if not _has_table("crr_activity_counts"):
        op.create_table(
            "crr_activity_counts",
            _activity_fk(),
            sa.Column(
                "measure_id",
                sa.String(36),
                sa.ForeignKey("crr_activity_measures.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            _org_column(),
            sa.Column("quantity", sa.Integer(), nullable=False),
            sa.CheckConstraint("quantity >= 0", name="ck_crr_activity_counts_quantity"),
        )
        op.create_index(
            "ix_crr_activity_counts_measure", "crr_activity_counts", ["measure_id"]
        )
        op.create_index(
            "ix_crr_activity_counts_org", "crr_activity_counts", ["organization_id"]
        )

    if not _has_table("crr_activity_tags"):
        op.create_table(
            "crr_activity_tags",
            _activity_fk(),
            sa.Column(
                "tag_id",
                sa.String(36),
                sa.ForeignKey("crr_tags.id", ondelete="RESTRICT"),
                primary_key=True,
            ),
            _org_column(),
        )
        op.create_index("ix_crr_activity_tags_tag", "crr_activity_tags", ["tag_id"])
        op.create_index(
            "ix_crr_activity_tags_org", "crr_activity_tags", ["organization_id"]
        )

    if not _has_table("crr_activity_members"):
        op.create_table(
            "crr_activity_members",
            _activity_fk(),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            _org_column(),
            sa.Column("minutes", sa.Integer(), nullable=False),
            sa.CheckConstraint(
                "minutes >= 0 AND minutes <= 1440",
                name="ck_crr_activity_members_minutes",
            ),
        )
        op.create_index(
            "ix_crr_activity_members_user", "crr_activity_members", ["user_id"]
        )
        op.create_index(
            "ix_crr_activity_members_org", "crr_activity_members", ["organization_id"]
        )


def _alter_existing() -> None:
    if _has_table("crr_activity_types") and not _has_column(
        "crr_activity_types", "admin_hours_category_id"
    ):
        op.add_column(
            "crr_activity_types",
            sa.Column(
                "admin_hours_category_id",
                sa.String(36),
                sa.ForeignKey(
                    "admin_hours_categories.id",
                    ondelete="SET NULL",
                    name="fk_crr_activity_types_admin_hours_category",
                ),
                nullable=True,
            ),
        )

    if _has_table(ENTRIES):
        # MySQL changes an ENUM's values only through ALTER COLUMN.
        op.alter_column(
            ENTRIES,
            "entry_method",
            type_=sa.Enum(*_NEW_METHODS, name="adminhoursentrymethod"),
            existing_type=sa.Enum(*_OLD_METHODS, name="adminhoursentrymethod"),
            existing_nullable=False,
        )
        if not _has_column(ENTRIES, "source_crr_activity_id"):
            op.add_column(
                ENTRIES,
                sa.Column(
                    "source_crr_activity_id",
                    sa.String(36),
                    sa.ForeignKey(
                        "crr_activities.id",
                        ondelete="SET NULL",
                        name="fk_admin_hours_entries_source_crr",
                    ),
                    nullable=True,
                ),
            )
            op.create_index(
                "ix_admin_hours_entries_source_crr", ENTRIES, ["source_crr_activity_id"]
            )


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, mutate) -> None:
    rows = bind.execute(
        sa.text(
            "SELECT id, slug, permissions FROM positions WHERE is_system = :is_system"
        ),
        {"is_system": True},
    ).fetchall()
    for row in rows:
        current = _load_permissions(row.permissions)
        updated = mutate(row.slug, current)
        if updated == current:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def _grant(slug, permissions):
    held = set(permissions)
    added: list[str] = []
    for permission, evidence in _EVIDENCE_GRANTS:
        if held & evidence and permission not in held and permission not in added:
            added.append(permission)
    for permission, slugs in _SLUG_GRANTS:
        if slug in slugs and permission not in held and permission not in added:
            added.append(permission)
    return permissions + added


def _revoke(_slug, permissions):
    return [p for p in permissions if p not in _GRANTED]


def upgrade() -> None:
    _create_tables()
    _alter_existing()
    if _has_table("positions"):
        _rewrite(op.get_bind(), _grant)


def downgrade() -> None:
    if _has_table("positions"):
        _rewrite(op.get_bind(), _revoke)
    if _has_table(ENTRIES):
        if _has_column(ENTRIES, "source_crr_activity_id"):
            op.drop_index("ix_admin_hours_entries_source_crr", table_name=ENTRIES)
            op.drop_constraint(
                "fk_admin_hours_entries_source_crr", ENTRIES, type_="foreignkey"
            )
            op.drop_column(ENTRIES, "source_crr_activity_id")
        op.execute(
            sa.text(
                "UPDATE admin_hours_entries SET entry_method = 'manual' "
                "WHERE entry_method = 'crr_activity'"
            )
        )
        op.alter_column(
            ENTRIES,
            "entry_method",
            type_=sa.Enum(*_OLD_METHODS, name="adminhoursentrymethod"),
            existing_type=sa.Enum(*_NEW_METHODS, name="adminhoursentrymethod"),
            existing_nullable=False,
        )
    if _has_table("crr_activity_types") and _has_column(
        "crr_activity_types", "admin_hours_category_id"
    ):
        op.drop_constraint(
            "fk_crr_activity_types_admin_hours_category",
            "crr_activity_types",
            type_="foreignkey",
        )
        op.drop_column("crr_activity_types", "admin_hours_category_id")
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")
