"""Encrypt sensitive shift report fields at rest

Applies AES-256 encryption to existing plaintext values in:
- officer_narrative
- areas_of_strength
- areas_for_improvement
- reviewer_notes

Revision ID: 20260222_1000
Revises: 20260222_0900
Create Date: 2026-02-22 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260222_1000'
down_revision = '20260222_0900'
branch_labels = None
depends_on = None

ENCRYPTED_FIELDS = [
    'officer_narrative',
    'areas_of_strength',
    'areas_for_improvement',
    'reviewer_notes',
]


def upgrade() -> None:
    """Encrypt existing plaintext values in sensitive columns."""
    from app.core.security import encrypt_data

    conn = op.get_bind()
    reports = conn.execute(
        sa.text("SELECT id, officer_narrative, areas_of_strength, areas_for_improvement, reviewer_notes FROM shift_completion_reports")
    ).fetchall()

    for row in reports:
        updates = {}
        for field in ENCRYPTED_FIELDS:
            value = getattr(row, field, None) if hasattr(row, field) else row._mapping.get(field)
            if value and value.strip():
                updates[field] = encrypt_data(value)

        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            updates["id"] = row._mapping.get("id") if hasattr(row, '_mapping') else row[0]
            conn.execute(
                sa.text(f"UPDATE shift_completion_reports SET {set_clause} WHERE id = :id"),
                updates,
            )


def downgrade() -> None:
    """Decrypt values back to plaintext."""
    from app.core.security import decrypt_data
    from cryptography.fernet import InvalidToken

    conn = op.get_bind()
    reports = conn.execute(
        sa.text("SELECT id, officer_narrative, areas_of_strength, areas_for_improvement, reviewer_notes FROM shift_completion_reports")
    ).fetchall()

    for row in reports:
        updates = {}
        for field in ENCRYPTED_FIELDS:
            value = getattr(row, field, None) if hasattr(row, field) else row._mapping.get(field)
            if value and value.strip():
                try:
                    updates[field] = decrypt_data(value)
                except (InvalidToken, Exception):
                    pass  # Already plaintext

        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            updates["id"] = row._mapping.get("id") if hasattr(row, '_mapping') else row[0]
            conn.execute(
                sa.text(f"UPDATE shift_completion_reports SET {set_clause} WHERE id = :id"),
                updates,
            )
