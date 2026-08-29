"""Merge administrative-seat and message-recipient migration heads.

Revision ID: c6d7e8f9a0b1
Revises: b8d5f0c24a69, 5b165386cc5f
Create Date: 2026-08-29 02:30:00
"""

revision = "c6d7e8f9a0b1"
down_revision = ("b8d5f0c24a69", "5b165386cc5f")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Join the migration branches without changing the schema."""


def downgrade() -> None:
    """Split the migration branches without changing the schema."""
