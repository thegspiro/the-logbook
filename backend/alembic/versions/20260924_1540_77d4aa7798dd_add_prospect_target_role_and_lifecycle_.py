"""add prospect target role and lifecycle stamps

Adds the six columns that `ProspectiveMember` gained so the applicant drawer's
target-role, deactivation and withdrawal displays have something to read, and
so `transfer_to_membership` can apply the role the pipeline decided on.

The five lifecycle columns are backfilled from `prospect_activity_log`, which
has been recording every status change — including the reason — through
`_apply_status_change` since well before this revision. Without the backfill an
existing department would see blank dates on applications it withdrew years
ago, which is the same empty rendering these columns exist to end.

Revision ID: 77d4aa7798dd
Revises: 1b52ea3a079e
Create Date: 2026-09-24 15:40:49.021099

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "77d4aa7798dd"
down_revision: Union[str, None] = "1b52ea3a079e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "prospective_members"
LOG = "prospect_activity_log"
ROLES = "positions"

NEW_COLUMNS = (
    ("target_role_id", sa.String(36)),
    ("deactivated_at", sa.DateTime(timezone=True)),
    ("deactivated_reason", sa.Text()),
    ("reactivated_at", sa.DateTime(timezone=True)),
    ("withdrawn_at", sa.DateTime(timezone=True)),
    ("withdrawal_reason", sa.Text()),
)

FK_NAME = "fk_prospective_members_target_role_id"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return name in {fk["name"] for fk in inspector.get_foreign_keys(table)}


def upgrade() -> None:
    # Every step is guarded on the column's absence rather than assumed: a
    # deployment runs `alembic upgrade head` and then `scripts/repair_schema.py`,
    # which adds columns the models declare, so on a database repaired before
    # this revision ran the columns are already here and a bare add_column
    # would fail the whole upgrade.
    if not _has_table(TABLE):
        return

    for name, type_ in NEW_COLUMNS:
        if not _has_column(TABLE, name):
            op.add_column(TABLE, sa.Column(name, type_, nullable=True))

    # SET NULL, and therefore nullable — a deleted role must not delete the
    # application that wanted it (CLAUDE.md pitfall #2).
    #
    # `positions`, not `roles`: 20260805_0008 renamed the table and `Role` is
    # now only a Python alias of `Position`. The column keeps the `role`
    # wording to match TransferProspectRequest.role_ids, which it feeds.
    if _has_table(ROLES) and not _has_fk(TABLE, FK_NAME):
        op.create_foreign_key(
            FK_NAME, TABLE, ROLES, ["target_role_id"], ["id"], ondelete="SET NULL"
        )

    _backfill_lifecycle_stamps()


def _backfill_lifecycle_stamps() -> None:
    """Fill the five lifecycle columns from the activity log.

    **These are historical stamps, not current-status flags**, and the drawer
    is what settles that: its Details block renders "Deactivated: …" and "Last
    reactivated: …" for an applicant whatever their status is now, and its
    inactive banner expects to show a *prior* reactivation on a record that is
    inactive again. So each column records the most recent transition of its
    kind whenever it happened, and none is filtered on where the application
    stands today. `_apply_status_change` stamps forward on the same rule and
    never clears, so the two agree.

    Each statement fills only NULLs, so this is re-runnable and cannot
    overwrite a stamp written by a later status change. A prospect whose
    transition predates the activity log has no row to read and is left NULL
    rather than stamped with a guess. `details` is a JSON column holding
    `{"from", "to", "reason", "bulk"}`; JSON_EXTRACT, JSON_UNQUOTE and
    ROW_NUMBER are available on both supported engines (MySQL 8.0, MariaDB
    10.11).
    """
    if not _has_table(LOG):
        return

    for at_column, reason_column, predicate in (
        (
            "withdrawn_at",
            "withdrawal_reason",
            "JSON_UNQUOTE(JSON_EXTRACT(details, '$.to')) = 'withdrawn'",
        ),
        (
            "deactivated_at",
            "deactivated_reason",
            "JSON_UNQUOTE(JSON_EXTRACT(details, '$.to')) = 'inactive'",
        ),
        (
            "reactivated_at",
            None,
            "JSON_UNQUOTE(JSON_EXTRACT(details, '$.from')) = 'inactive'"
            " AND JSON_UNQUOTE(JSON_EXTRACT(details, '$.to')) = 'active'",
        ),
    ):
        # A join to the newest matching row per prospect, rather than a
        # correlated subquery per column: one pass, and it touches only the
        # prospects that actually have such a row.
        assignments = f"p.{at_column} = latest.created_at"
        if reason_column:
            assignments += f", p.{reason_column} = latest.reason"
        op.execute(sa.text(f"""
                UPDATE {TABLE} p
                JOIN (
                    SELECT
                        prospect_id,
                        created_at,
                        JSON_UNQUOTE(JSON_EXTRACT(details, '$.reason')) AS reason,
                        ROW_NUMBER() OVER (
                            PARTITION BY prospect_id ORDER BY created_at DESC
                        ) AS rn
                    FROM {LOG}
                    WHERE action = 'prospect_status_changed'
                      AND {predicate}
                ) latest
                  ON latest.prospect_id = p.id AND latest.rn = 1
                SET {assignments}
                WHERE p.{at_column} IS NULL
                """))


def downgrade() -> None:
    """Drop the six columns.

    The backfilled values are reconstructible — `prospect_activity_log` is
    what they were read from and is not touched here — but a target role set
    through the picker after this revision ran lives only in `target_role_id`
    and is lost on the way down. That is stated rather than worked around: a
    column that cannot be dropped is not reversible in any useful sense.
    """
    if not _has_table(TABLE):
        return

    if _has_fk(TABLE, FK_NAME):
        op.drop_constraint(FK_NAME, TABLE, type_="foreignkey")

    for name, _ in NEW_COLUMNS:
        if _has_column(TABLE, name):
            op.drop_column(TABLE, name)
