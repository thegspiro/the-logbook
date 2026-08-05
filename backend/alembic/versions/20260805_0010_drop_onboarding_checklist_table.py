"""Drop the unused onboarding_checklist table

``complete_onboarding`` seeded ten static infrastructure tasks (TLS, firewall,
backups, monitoring, ...) into ``onboarding_checklist`` on every completed
setup, and exposed them at ``GET /api/v1/onboarding/checklist``. No client ever
called that endpoint — the rows were written and never read.

The department setup checklist (``GET /api/v1/organization/setup-checklist``)
is the live one: it derives completion from real entity counts instead of a
static seeded list, is org-scoped, and is what ``/setup`` and the dashboard
progress card render. Keeping two competing "post-onboarding checklist"
concepts invited the wrong one being extended, so the dead one goes.

Revision ID: 20260805_0010
Revises: 20260805_0009
Create Date: 2026-08-05

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0010"
down_revision = "20260805_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Guard: chain-built databases have this table, but a database stamped from
    # a newer baseline may not. Dropping a missing table aborts the migration.
    if "onboarding_checklist" in inspector.get_table_names():
        op.drop_table("onboarding_checklist")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "onboarding_checklist" in inspector.get_table_names():
        return

    op.create_table(
        "onboarding_checklist",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("category", sa.String(50)),
        sa.Column("priority", sa.String(20)),
        sa.Column("is_completed", sa.Boolean(), server_default="0"),
        sa.Column("completed_at", sa.DateTime()),
        sa.Column("completed_by", sa.String(36)),
        sa.Column("documentation_link", sa.Text()),
        sa.Column("estimated_time_minutes", sa.Integer()),
        sa.Column("sort_order", sa.Integer(), server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP")
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
    )
