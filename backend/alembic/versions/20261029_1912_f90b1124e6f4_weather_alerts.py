"""Weather alerts

Revision ID: f90b1124e6f4
Revises: e8a3f5c1b7d2
Create Date: 2026-10-29 19:12:00.000000

Adds ``weather_alerts``: one row per NWS alert id per department, written by
the weather polling task (owner decision 2026-10-29, KNOWN_LIMITATIONS
"Integrations — Weather Alerts and Generic Webhooks Do Nothing After Their
Test"). The unique key on ``(organization_id, nws_id)`` is what lets a second
poll of the same alert notify nobody.

A new table, so no existing row is touched. Safe to run twice: it is created
only when absent. The downgrade drops the table and with it the record of which
alerts each department has seen, so after a downgrade and a fresh upgrade the
alerts still active would be announced again.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f90b1124e6f4"
down_revision: Union[str, None] = "e8a3f5c1b7d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "weather_alerts"


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if _has_table(TABLE):
        return
    op.create_table(
        TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("nws_id", sa.String(255), nullable=False),
        sa.Column("event", sa.String(255), nullable=False),
        sa.Column("severity", sa.String(32), nullable=False),
        sa.Column("urgency", sa.String(32), nullable=True),
        sa.Column("headline", sa.String(500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("instruction", sa.Text(), nullable=True),
        sa.Column("area_desc", sa.Text(), nullable=True),
        sa.Column("onset", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "organization_id", "nws_id", name="uq_weather_alerts_org_nws_id"
        ),
    )
    op.create_index(
        "ix_weather_alerts_org_ended", TABLE, ["organization_id", "ended_at"]
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")
