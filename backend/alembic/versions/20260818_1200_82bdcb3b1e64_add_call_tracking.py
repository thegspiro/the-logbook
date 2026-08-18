"""Add PII-free call tracking (org_calls, org_call_responses)

Revision ID: 82bdcb3b1e64
Revises: 8050e5a61f34
Create Date: 2026-08-18

Backs call-volume tracking for departments that do not run incident reporting.
See app/models/call_tracking.py for what these tables deliberately do not hold
(no address, no patient identity, no narrative, no response times, no CAD
incident number) and why a call *row* is required rather than an integer on the
shift: two per-unit counts cannot be deduplicated, so a department total summed
from them double-counts every mutual response.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "82bdcb3b1e64"
down_revision = "8050e5a61f34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "org_calls" not in tables:
        op.create_table(
            "org_calls",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("call_date", sa.Date(), nullable=False),
            sa.Column("call_type", sa.String(50), nullable=True),
            sa.Column(
                "source",
                sa.String(20),
                nullable=False,
                server_default="manual",
            ),
            sa.Column("external_ref", sa.String(100), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
            sa.Column(
                "created_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_org_calls_organization_id", "org_calls", ["organization_id"]
        )
        op.create_index("ix_org_calls_call_date", "org_calls", ["call_date"])
        op.create_index(
            "idx_org_call_org_date", "org_calls", ["organization_id", "call_date"]
        )
        # Idempotent dispatch re-sync: without this a poll that re-reads the
        # same window duplicates the day's calls on every run.
        op.create_unique_constraint(
            "uq_org_call_external_ref", "org_calls", ["organization_id", "external_ref"]
        )

    if "org_call_responses" not in tables:
        op.create_table(
            "org_call_responses",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "call_id",
                sa.String(36),
                sa.ForeignKey("org_calls.id", ondelete="CASCADE"),
                nullable=False,
            ),
            # SET NULL, so nullable=True (pitfall #2 / MySQL 1830). Deleting a
            # shift must not retroactively reduce the department's call volume.
            sa.Column(
                "shift_id",
                sa.String(36),
                sa.ForeignKey("shifts.id", ondelete="SET NULL"),
                nullable=True,
            ),
            # Polymorphic like shifts.apparatus_id — resolves against either
            # apparatus table, so no FK. See utils/apparatus_ref.
            sa.Column("apparatus_id", sa.String(36), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
            ),
        )
        op.create_index(
            "ix_org_call_responses_organization_id",
            "org_call_responses",
            ["organization_id"],
        )
        op.create_index(
            "ix_org_call_responses_call_id", "org_call_responses", ["call_id"]
        )
        op.create_index(
            "ix_org_call_responses_shift_id", "org_call_responses", ["shift_id"]
        )
        op.create_index(
            "ix_org_call_responses_apparatus_id", "org_call_responses", ["apparatus_id"]
        )
        op.create_index(
            "idx_call_response_apparatus",
            "org_call_responses",
            ["organization_id", "apparatus_id"],
        )
        op.create_index("idx_call_response_shift", "org_call_responses", ["shift_id"])
        # A unit responds to a given call once. Without this, re-finalizing a
        # shift adds a duplicate run to the apparatus tally on every correction.
        op.create_unique_constraint(
            "uq_call_response_apparatus",
            "org_call_responses",
            ["call_id", "apparatus_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "org_call_responses" in tables:
        op.drop_table("org_call_responses")
    if "org_calls" in tables:
        op.drop_table("org_calls")
