"""member_status holds membership tier ids

``users.member_status`` was the fixed seven-word ladder, and a department's own
membership tier (the shipped ``senior``) lived only in the legacy
``membership_type`` column. Such a member therefore stood on no rung the ladder
column could see: ``member_status`` was either NULL (the August backfill
declined to guess) or stale (the rung they left before the tier change). The
ladder column now carries the tier id itself, in the spelling
``app.utils.membership.canonical_member_status`` fixes, so it is widened from 20
to 50 characters -- the length ``MembershipTier.id`` already allowed -- and the
rows that hold a tier id in the legacy column are settled onto it.

Only the status is written. ``member_class`` is deliberately left as it is,
NULL included (owner decision 2026-10-29): a tier member whose class was never
recorded is flagged on the roster for an officer to set, not guessed onto the
operational body by a migration.

The seven legacy words are inlined rather than imported (pitfall #20): a
migration must keep transforming rows the way it did the day it ran.

The downgrade narrows the column back and, because MySQL in strict mode
refuses to truncate, first NULLs any value longer than 20 characters. The
backfill itself is not reversed: a tier id written here is exactly what the
legacy column still holds, so nothing is lost by leaving it.

Revision ID: c4d7e2a91b60
Revises: b74bcce55c11
Create Date: 2026-10-29 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4d7e2a91b60"
down_revision: Union[str, None] = "b74bcce55c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The legacy ``membership_type`` vocabulary as of this revision. A value in this
# set is a class/status word the earlier split migration already settled; any
# other non-blank value is a department tier id.
_LEGACY_WORDS = (
    "prospective",
    "probationary",
    "active",
    "life",
    "retired",
    "administrative",
    "honorary",
)


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded although a migration does create `users`: a backfill has nothing
    # to rewrite on a database that has not built the table yet (pitfall #26).
    if not _has_table("users") or not _has_column("users", "member_status"):
        return

    # Widening never fails on existing rows (pitfall #35). SQLite has no
    # ALTER COLUMN and enforces no VARCHAR length, so the widening is only a
    # statement on the databases that need one.
    if op.get_bind().dialect.name != "sqlite":
        op.alter_column(
            "users",
            "member_status",
            existing_type=sa.String(length=20),
            type_=sa.String(length=50),
            existing_nullable=True,
        )

    legacy = ", ".join(f"'{word}'" for word in _LEGACY_WORDS)
    op.execute(
        sa.text(
            "UPDATE users SET member_status = LOWER(TRIM(membership_type)) "
            "WHERE membership_type IS NOT NULL "
            "AND TRIM(membership_type) <> '' "
            f"AND LOWER(TRIM(membership_type)) NOT IN ({legacy}) "
            "AND (member_status IS NULL "
            "OR member_status <> LOWER(TRIM(membership_type)))"
        )
    )


def downgrade() -> None:
    if not _has_table("users") or not _has_column("users", "member_status"):
        return
    op.execute(
        sa.text(
            "UPDATE users SET member_status = NULL WHERE LENGTH(member_status) > 20"
        )
    )
    if op.get_bind().dialect.name != "sqlite":
        op.alter_column(
            "users",
            "member_status",
            existing_type=sa.String(length=50),
            type_=sa.String(length=20),
            existing_nullable=True,
        )
