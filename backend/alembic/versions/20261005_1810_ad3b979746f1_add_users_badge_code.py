"""Add ``users.badge_code`` — the server-issued code a member badge carries.

Member badges encoded the membership number, or a short form of the member's
id, both of which every member can read off the directory, so anyone could
print a working copy of a colleague's badge. A badge now carries a random code
the server issues; this adds the column, gives every existing member one, and
makes it unique per organization.

The codes are generated here with an inlined copy of the alphabet and length
rather than by importing ``app.utils.member_badge``: a migration must keep
doing what it did the day it ran, and that helper is free to change.

Existing badges keep scanning: until a department switches off old-style
badges, the lookup still accepts the membership number and short id, so
nothing printed before this upgrade stops working on upgrade day.

Idempotent: the column and index are added only when absent, and only rows
without a code are filled, so an installation whose ``repair_schema`` already
added the column from the model is completed rather than overwritten.

**Downgrade** drops the index and the column. Badges printed with a code stop
scanning after a downgrade, because nothing below this revision reads it.

Revision ID: ad3b979746f1
Revises: 34d3d56d1479
Create Date: 2026-10-05 18:10:17.427238
"""

import secrets

import sqlalchemy as sa
from alembic import op

revision = "ad3b979746f1"
down_revision = "34d3d56d1479"
branch_labels = None
depends_on = None

_INDEX = "idx_user_org_badge_code"
_PREFIX = "MB-"
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTWXYZ"
_RANDOM_LENGTH = 10
_BATCH = 500


def _inspector():
    return sa.inspect(op.get_bind())


def _has_column(table: str, column: str) -> bool:
    inspector = _inspector()
    if table not in inspector.get_table_names():
        return False
    return column in {c["name"] for c in inspector.get_columns(table)}


def _has_index(table: str, name: str) -> bool:
    inspector = _inspector()
    if table not in inspector.get_table_names():
        return False
    return name in {i["name"] for i in inspector.get_indexes(table)}


def _new_code(taken: set) -> str:
    while True:
        code = _PREFIX + "".join(
            secrets.choice(_ALPHABET) for _ in range(_RANDOM_LENGTH)
        )
        if code not in taken:
            taken.add(code)
            return code


def _backfill() -> None:
    bind = op.get_bind()
    taken = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT badge_code FROM users WHERE badge_code IS NOT NULL")
        )
    }
    while True:
        ids = [
            row[0]
            for row in bind.execute(
                sa.text("SELECT id FROM users WHERE badge_code IS NULL LIMIT :batch"),
                {"batch": _BATCH},
            )
        ]
        if not ids:
            return
        for user_id in ids:
            bind.execute(
                sa.text("UPDATE users SET badge_code = :code WHERE id = :id"),
                {"code": _new_code(taken), "id": user_id},
            )


def upgrade() -> None:
    if not _has_column("users", "id"):
        return
    if not _has_column("users", "badge_code"):
        op.add_column(
            "users",
            sa.Column("badge_code", sa.String(length=16), nullable=True),
        )
    _backfill()
    if not _has_index("users", _INDEX):
        op.create_index(_INDEX, "users", ["organization_id", "badge_code"], unique=True)


def downgrade() -> None:
    if _has_index("users", _INDEX):
        op.drop_index(_INDEX, table_name="users")
    if _has_column("users", "badge_code"):
        op.drop_column("users", "badge_code")
