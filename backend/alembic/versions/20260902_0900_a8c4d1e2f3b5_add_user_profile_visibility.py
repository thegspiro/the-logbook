"""Add users.profile_visibility — a member's own choice of what colleagues see.

Until now the only control over who sees a member's contact details was the
organisation-wide ``contact_info_visibility`` setting, which decides for every
member at once, and the home address and personal email were hidden from other
members unconditionally. This column lets each member choose per field.

Stored shape is a JSON object with five booleans — ``email``,
``personal_email``, ``phone``, ``mobile``, ``address`` — written only as a
whole by ``PUT /users/me/profile-visibility``. NULL means the member has never
chosen and resolves to ``app.schemas.user.PROFILE_VISIBILITY_DEFAULTS``, which
reproduce the pre-migration behaviour exactly, so there is nothing to backfill
and no installation's roster changes on upgrade.

**Reversible.** The downgrade drops the column; a member who had made a choice
reverts to the defaults, which is the only state the old code could express.

Revision ID: a8c4d1e2f3b5
Revises: f7b3c8d2e569
Create Date: 2026-09-02 09:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a8c4d1e2f3b5"
down_revision = "f7b3c8d2e569"
branch_labels = None
depends_on = None


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded although a migration does create `users`: reflecting an absent
    # table would take down the whole upgrade rather than this step
    # (pitfall #26), and `create_all` builds the column from the model anyway.
    if not _has_table("users"):
        return

    if not _has_column("users", "profile_visibility"):
        op.add_column(
            "users",
            sa.Column("profile_visibility", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    if not _has_table("users"):
        return

    if _has_column("users", "profile_visibility"):
        op.drop_column("users", "profile_visibility")
