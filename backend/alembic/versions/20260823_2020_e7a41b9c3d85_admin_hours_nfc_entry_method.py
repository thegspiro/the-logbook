"""Add nfc_station to the admin_hours entry_method enum.

Revision ID: e7a41b9c3d85
Revises: d5e82c0a7f31

An ID card tapped at an officer-operated station was being recorded as
``qr_scan`` — the value the clock-in path was originally written for — so
exports and audits claimed a member had scanned a category's QR code with their
own phone when in fact somebody else had tapped their card at a station. The
two are different acts by different people and need to be distinguishable.

Existing rows are left as they are. A historical ``qr_scan`` really was written
by the QR path; rewriting any of them would be inventing a provenance the
database never recorded.
"""

import sqlalchemy as sa
from alembic import op

revision = "e7a41b9c3d85"
down_revision = "d5e82c0a7f31"
branch_labels = None
depends_on = None

_OLD = ("qr_scan", "manual", "event_attendance")
_NEW = ("qr_scan", "nfc_station", "manual", "event_attendance")


def upgrade() -> None:
    # MySQL requires ALTER COLUMN to change enum values.
    op.alter_column(
        "admin_hours_entries",
        "entry_method",
        type_=sa.Enum(*_NEW, name="adminhoursentrymethod"),
        existing_type=sa.Enum(*_OLD, name="adminhoursentrymethod"),
        existing_nullable=False,
    )


def downgrade() -> None:
    # Rows recorded by a station have no honest older value to fall back to;
    # `qr_scan` is the closest self-service ancestor and is what the column
    # held for this path before the split. Narrowing the enum with any such row
    # still present would otherwise fail or truncate.
    op.execute(
        sa.text(
            "UPDATE admin_hours_entries SET entry_method = 'qr_scan' "
            "WHERE entry_method = 'nfc_station'"
        )
    )
    op.alter_column(
        "admin_hours_entries",
        "entry_method",
        type_=sa.Enum(*_OLD, name="adminhoursentrymethod"),
        existing_type=sa.Enum(*_NEW, name="adminhoursentrymethod"),
        existing_nullable=False,
    )
