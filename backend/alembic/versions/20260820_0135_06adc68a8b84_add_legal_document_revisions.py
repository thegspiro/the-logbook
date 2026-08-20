"""Add legal_document_revisions and the legal.propose / legal.publish grants

Governance -> Legal Documents lets the secretary and department leaders read
the wording published on /privacy and /terms and propose alternatives that fit
local rules, with publishing held behind a separate grant.

Two parts:

1. The ``legal_document_revisions`` table. The live text still lives in
   ``organizations.settings["legal"]`` (that is what the anonymous public
   endpoint reads); these rows are the governance record around it — who
   proposed which wording, why, who published it, and what the page said
   before.

2. A backfill of the two new permissions onto existing positions. Positions are
   seeded from DEFAULT_POSITIONS at organization creation, so without this only
   organizations created after the deploy would get them, and the screen would
   be unreachable on every existing install except to a wildcard admin.

The grant rule mirrors the split departments already understand: a position
that can see settings can propose, a position that can manage settings can
publish.

Revision ID: 06adc68a8b84
Revises: 8050e5a61f34
Create Date: 2026-08-20 01:35:37.466085

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "06adc68a8b84"
down_revision: Union[str, None] = "8050e5a61f34"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PROPOSE = "legal.propose"
_PUBLISH = "legal.publish"

# Grants that already cover each new permission; a position holding one of
# these needs no new entry.
_COVERED_BY = {
    _PROPOSE: ("*", "legal.*", _PROPOSE),
    _PUBLISH: ("*", "legal.*", _PUBLISH),
}

# The existing grant that earns each new one.
_EARNED_BY = {
    _PROPOSE: ("settings.view", "settings.*"),
    _PUBLISH: ("settings.manage", "settings.*"),
}


def _load_permissions(raw):
    if isinstance(raw, str):
        raw = json.loads(raw or "[]")
    return list(raw or [])


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "legal_document_revisions" not in inspector.get_table_names():
        op.create_table(
            "legal_document_revisions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("organization_id", sa.String(length=36), nullable=False),
            sa.Column(
                "document_type",
                sa.Enum(
                    "privacy_policy",
                    "terms_of_service",
                    name="legaldocumenttype",
                ),
                nullable=False,
            ),
            sa.Column(
                "status",
                sa.Enum(
                    "draft",
                    "published",
                    "archived",
                    name="legalrevisionstatus",
                ),
                nullable=False,
                server_default="draft",
            ),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("change_note", sa.Text(), nullable=False),
            sa.Column("effective_date", sa.String(length=64), nullable=True),
            # SET NULL columns must be nullable or MySQL rejects the FK with
            # error 1830 (pitfall #2).
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("published_by", sa.String(length=36), nullable=True),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(
                ["organization_id"], ["organizations.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["published_by"], ["users.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_legal_revisions_org_type_status",
            "legal_document_revisions",
            ["organization_id", "document_type", "status"],
        )

    # positions is materialized by startup create_all, which runs AFTER
    # migrations on a fresh install — nothing to backfill when it is absent,
    # and new organizations seed both grants from DEFAULT_POSITIONS anyway.
    if "positions" not in inspector.get_table_names():
        return

    rows = bind.execute(sa.text("SELECT id, permissions FROM positions")).fetchall()
    for row in rows:
        perms = _load_permissions(row.permissions)
        changed = False
        for new_perm in (_PROPOSE, _PUBLISH):
            if any(covered in perms for covered in _COVERED_BY[new_perm]):
                continue
            if not any(earned in perms for earned in _EARNED_BY[new_perm]):
                continue
            perms.append(new_perm)
            changed = True
        if changed:
            bind.execute(
                sa.text("UPDATE positions SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(perms), "id": row.id},
            )


def downgrade() -> None:
    # The table goes; the permission strings stay.
    #
    # Dropping the table is safe and complete — it is new in this revision, and
    # the text members actually read lives in organizations.settings, which this
    # migration never touched, so a downgrade cannot blank a published notice.
    # It does discard proposal history, which is the accepted cost of undoing
    # the feature that created it.
    #
    # The grants are deliberately left in place, for the same reason as
    # 20260813_0008: this migration records nothing about which positions it
    # touched, so a legal.propose entry is indistinguishable from one an
    # administrator granted afterwards through the position editor. Revoking
    # them all would silently strip tenant-managed grants. The strings are inert
    # once the endpoints are gone.
    bind = op.get_bind()
    if "legal_document_revisions" in sa.inspect(bind).get_table_names():
        op.drop_index(
            "ix_legal_revisions_org_type_status",
            table_name="legal_document_revisions",
        )
        op.drop_table("legal_document_revisions")
