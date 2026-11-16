"""Apparatus events: templates, per-night crew plans, and their grants.

Adds the six tables behind apparatus events — outreach that rolls an
apparatus with a named crew but is not a shift:

* ``apparatus_event_templates`` / ``apparatus_event_template_units`` /
  ``apparatus_event_template_seats`` — a department's reusable plans.
* ``event_apparatus_plans`` / ``event_apparatus_units`` /
  ``event_apparatus_seats`` — the plan copied onto each scheduled night (an
  ordinary ``events`` row), and who holds each seat.

All six are new, so no existing row is touched by the table half. Each
``create_table`` is skipped when the table already exists, because app
startup's ``create_all`` can build them from the models before this revision
runs on an installation that upgrades in place.

**Grants — direction: adding, gated on each grant's own absence**, as
``02c94bb742d6`` did. ``apparatus_events.manage`` and
``apparatus_events.signup`` did not exist before this revision, so no position
editor could have offered or removed them; their absence says nothing about a
department's choice. The rule matches the registry's: a seeded (``is_system``)
position holding ``events.manage`` gains ``apparatus_events.manage``, and one
holding ``events.view`` or ``events.manage`` gains ``apparatus_events.signup``.
A position a department created is theirs and is left alone. ``*`` already
covers both; ``events.*`` does not (it is a different module prefix), so it
counts as evidence for both.

Idempotent: a grant already present is not added twice. The downgrade drops
the tables (crew assignments with them) and takes the two grants back off
seeded rows; a department that granted one deliberately after the upgrade
loses it too, which is the cost of reversing a grant nothing distinguishes
from the seed.

Revision ID: 3f8a1c6e2b94
Revises: 053d3e96b4fa
Create Date: 2026-11-16 16:02:22.764791
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "3f8a1c6e2b94"
down_revision: Union[str, None] = "053d3e96b4fa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen at this revision, not imported from the registry.
# Each grant with the stored permissions that are evidence for it.
_EVIDENCE_GRANTS = (
    ("apparatus_events.manage", frozenset({"events.manage", "events.*"})),
    (
        "apparatus_events.signup",
        frozenset({"events.view", "events.manage", "events.*"}),
    ),
)
_GRANTED = tuple(permission for permission, _evidence in _EVIDENCE_GRANTS)

# Child before parent, for the downgrade.
_TABLES = (
    "event_apparatus_seats",
    "event_apparatus_units",
    "event_apparatus_plans",
    "apparatus_event_template_seats",
    "apparatus_event_template_units",
    "apparatus_event_templates",
)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _timestamps():
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _create_tables() -> None:
    if not _has_table("apparatus_event_templates"):
        op.create_table(
            "apparatus_event_templates",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("default_start_time", sa.String(5), nullable=True),
            sa.Column(
                "duration_minutes", sa.Integer(), nullable=False, server_default="180"
            ),
            sa.Column("location", sa.String(300), nullable=True),
            sa.Column(
                "admin_hours_category_id",
                sa.String(36),
                sa.ForeignKey("admin_hours_categories.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "evoc_mode", sa.String(20), nullable=False, server_default="enforce"
            ),
            sa.Column(
                "allow_self_signup",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "show_on_schedule",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "duplicated_from_id",
                sa.String(36),
                sa.ForeignKey("apparatus_event_templates.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "is_archived", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            _timestamps(),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_apparatus_event_templates_org",
            "apparatus_event_templates",
            ["organization_id", "is_archived"],
        )

    if not _has_table("apparatus_event_template_units"):
        op.create_table(
            "apparatus_event_template_units",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "template_id",
                sa.String(36),
                sa.ForeignKey("apparatus_event_templates.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "apparatus_id",
                sa.String(36),
                sa.ForeignKey("apparatus.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _timestamps(),
        )
        op.create_index(
            "ix_apparatus_event_template_units_template",
            "apparatus_event_template_units",
            ["template_id"],
        )

    if not _has_table("apparatus_event_template_seats"):
        op.create_table(
            "apparatus_event_template_seats",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "unit_id",
                sa.String(36),
                sa.ForeignKey("apparatus_event_template_units.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column(
                "seat_type", sa.String(20), nullable=False, server_default="general"
            ),
            sa.Column("count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("note", sa.String(300), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _timestamps(),
        )
        op.create_index(
            "ix_apparatus_event_template_seats_unit",
            "apparatus_event_template_seats",
            ["unit_id"],
        )

    if not _has_table("event_apparatus_plans"):
        op.create_table(
            "event_apparatus_plans",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(36),
                sa.ForeignKey("events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "template_id",
                sa.String(36),
                sa.ForeignKey("apparatus_event_templates.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("series_id", sa.String(36), nullable=False),
            sa.Column(
                "admin_hours_category_id",
                sa.String(36),
                sa.ForeignKey("admin_hours_categories.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "evoc_mode", sa.String(20), nullable=False, server_default="enforce"
            ),
            sa.Column(
                "allow_self_signup",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column(
                "show_on_schedule",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            _timestamps(),
        )
        op.create_index(
            "ux_event_apparatus_plans_event",
            "event_apparatus_plans",
            ["event_id"],
            unique=True,
        )
        op.create_index(
            "ix_event_apparatus_plans_series",
            "event_apparatus_plans",
            ["organization_id", "series_id"],
        )

    if not _has_table("event_apparatus_units"):
        op.create_table(
            "event_apparatus_units",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "plan_id",
                sa.String(36),
                sa.ForeignKey("event_apparatus_plans.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(36),
                sa.ForeignKey("events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "apparatus_id",
                sa.String(36),
                sa.ForeignKey("apparatus.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _timestamps(),
        )
        op.create_index(
            "ux_event_apparatus_units_event_app",
            "event_apparatus_units",
            ["event_id", "apparatus_id"],
            unique=True,
        )
        op.create_index(
            "ix_event_apparatus_units_apparatus",
            "event_apparatus_units",
            ["organization_id", "apparatus_id"],
        )

    if not _has_table("event_apparatus_seats"):
        op.create_table(
            "event_apparatus_seats",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "event_id",
                sa.String(36),
                sa.ForeignKey("events.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "unit_id",
                sa.String(36),
                sa.ForeignKey("event_apparatus_units.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column(
                "seat_type", sa.String(20), nullable=False, server_default="general"
            ),
            sa.Column("note", sa.String(300), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "user_id",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("assignment_method", sa.String(20), nullable=True),
            sa.Column(
                "assigned_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "ux_event_apparatus_seats_event_user",
            "event_apparatus_seats",
            ["event_id", "user_id"],
            unique=True,
        )
        op.create_index(
            "ix_event_apparatus_seats_unit", "event_apparatus_seats", ["unit_id"]
        )
        op.create_index(
            "ix_event_apparatus_seats_org_user",
            "event_apparatus_seats",
            ["organization_id", "user_id"],
        )


def _load_permissions(raw):
    """Normalize JSON values returned by different database drivers."""
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def _rewrite(bind, mutate) -> None:
    rows = bind.execute(
        sa.text("SELECT id, permissions FROM positions WHERE is_system = :is_system"),
        {"is_system": True},
    ).fetchall()
    for row in rows:
        current = _load_permissions(row.permissions)
        updated = mutate(current)
        if updated == current:
            continue
        bind.execute(
            sa.text("UPDATE positions SET permissions = :permissions WHERE id = :id"),
            {"permissions": json.dumps(updated), "id": row.id},
        )


def _grant(permissions):
    held = set(permissions)
    added = [
        permission
        for permission, evidence in _EVIDENCE_GRANTS
        if held & evidence and permission not in held
    ]
    return permissions + added


def _revoke(permissions):
    return [p for p in permissions if p not in _GRANTED]


def upgrade() -> None:
    _create_tables()
    if _has_table("positions"):
        _rewrite(op.get_bind(), _grant)


def downgrade() -> None:
    if _has_table("positions"):
        _rewrite(op.get_bind(), _revoke)
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table}")
