"""Create testing_checklist_entries.

Revision ID: b7c3e91d84af
Revises: d4e5f6a7b8c9

Backs the in-app testing home (`/testing`), whose run used to live in one
browser's localStorage. A checklist of permission gates is only meaningful
across accounts — the method is to sign in as a firefighter, a lieutenant and
a chief in turn and confirm each is refused what they should be — so the marks
have to be readable in one place, by the IT manager, rather than scattered
over three private windows.

One row per (organization, tester, route pattern), enforced by a unique index
so a double-tap cannot record a tester's finding twice.

Guarded on the table's existence, per CLAUDE.md pitfall #26: `create_all()`
builds this table for any installation that starts the app before running the
upgrade, and an unguarded CREATE TABLE then fails the whole migration run —
not merely this revision.
"""

import sqlalchemy as sa
from alembic import op

revision = "b7c3e91d84af"
# Re-pointed onto main's head each time this branch is brought up to date —
# d4e5f6a7b8c9 first, now a7c4e9b13f58, both of which branched from the same
# parent as this one. Two heads make `alembic upgrade head` abort outright,
# which takes out every CI job that builds a schema rather than merely the
# newest revision. Safe to re-point rather than add a merge node: these two
# revisions have never left this branch, so no deployed database has recorded
# a parentage this contradicts.
down_revision = "a7c4e9b13f58"
branch_labels = None
depends_on = None


_TABLE = "testing_checklist_entries"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


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
        sa.Column(
            "user_id",
            sa.String(36),
            # SET NULL, so nullable (pitfall #2): a hard-deleted member must
            # not take an archived run's evidence with them. See the model.
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("route_path", sa.String(200), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "untested",
                "pass",
                "fail",
                "blocked",
                name="testingcheckstatus",
            ),
            nullable=False,
            server_default="untested",
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column("tested_as", sa.JSON(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_testing_checklist_entries_organization_id", _TABLE, ["organization_id"]
    )
    op.create_index(
        "idx_testing_check_unique",
        _TABLE,
        ["organization_id", "user_id", "route_path"],
        unique=True,
    )


def downgrade() -> None:
    if _has_table(_TABLE):
        op.drop_table(_TABLE)
