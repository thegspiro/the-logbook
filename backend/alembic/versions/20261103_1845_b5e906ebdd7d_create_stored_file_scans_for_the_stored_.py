"""Create stored_file_scans for the stored-file malware scan

The ledger of ``app.services.stored_file_rescan``, the one-time malware scan
of files and images stored before upload scanning covered them (owner
decision 2026-11-01). One row per stored object the scan has reached; its
unique ``scan_key`` is what makes a second run skip an object already
scanned.

A new table only, so no existing row is touched, and it starts empty on
purpose: an empty ledger means every stored object is still unscanned, which
is the truth on every installation this upgrades. Skipped when the table
already exists, so a database ``create_all`` built first upgrades cleanly.

Downgrade drops the table and the record of what was scanned. Nothing else
is lost — removed infected files stay removed, and their detections stay in
the audit log — but upgrading again starts the scan from the beginning.

Revision ID: b5e906ebdd7d
Revises: 289504a34d3c
Create Date: 2026-11-03 18:45:05.904771

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5e906ebdd7d"
down_revision: Union[str, None] = "289504a34d3c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "stored_file_scans"


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if _has_table(_TABLE):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scan_key", sa.String(64), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("row_id", sa.String(36), nullable=False),
        sa.Column("reference", sa.Text(), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=True),
        sa.Column("verdict", sa.String(20), nullable=False),
        sa.Column("signature", sa.String(255), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("scan_key", name="uq_stored_file_scans_scan_key"),
    )
    op.create_index("idx_stored_file_scans_org", _TABLE, ["organization_id"])
    op.create_index(
        "idx_stored_file_scans_pending_removal", _TABLE, ["verdict", "removed_at"]
    )


def downgrade() -> None:
    if _has_table(_TABLE):
        op.drop_table(_TABLE)
