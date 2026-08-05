"""Give 18 foreign keys the ON DELETE rule their models declare

These foreign keys were created by ``op.create_table`` without an ``ondelete``
argument, so MySQL recorded them as ``RESTRICT``. The models declare ``CASCADE``
or ``SET NULL``. Startup schema repair cannot fix this — it only adds missing
tables and columns, never alters an existing constraint.

The visible symptom is deletions that fail instead of cascading: an election
cannot be deleted while candidates, votes or voting tokens reference it, an
organization cannot be deleted at all, and a member cannot be removed while any
apparatus record still names them.

Three columns on ``apparatus`` carry *two* foreign keys apiece
(``fk_apparatus_created_by`` with SET NULL alongside
``fk_apparatus_created_by_users`` with RESTRICT, and the same for
``archived_by`` and ``status_changed_by``) — a later migration added the correct
rule without dropping the original. Two constraints on one column with
conflicting delete rules is not a configuration MySQL resolves in the caller's
favour: the restrictive one still blocks the delete. Rebuilding each column's
foreign key from scratch collapses those pairs down to one.

Each column is therefore handled by dropping *every* foreign key on it that
points at the target table, then creating a single replacement under the
project's naming convention. That makes the revision idempotent and safe to
re-run.

``issuance_allowances.role_id`` is included because the model points it at
``positions``, but that table does not exist on a database built purely from
this chain (see DATABASE_SCHEMA_DRIFT.md finding #7). It is skipped when
``positions`` is absent rather than being repointed here, because moving that
foreign key is part of the unresolved roles/positions rename, not of this fix.

Revision ID: 20260805_0005
Revises: 20260805_0004
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0005"
down_revision = "20260805_0004"
branch_labels = None
depends_on = None


# (table, column, referred_table, referred_column, ondelete)
# Every SET NULL entry below is on a nullable column — MySQL error 1830
# rejects SET NULL against NOT NULL.
_FOREIGN_KEYS = [
    ("apparatus", "archived_by", "users", "id", "SET NULL"),
    ("apparatus", "created_by", "users", "id", "SET NULL"),
    ("apparatus", "status_changed_by", "users", "id", "SET NULL"),
    ("candidates", "election_id", "elections", "id", "CASCADE"),
    ("candidates", "nominated_by", "users", "id", "SET NULL"),
    ("candidates", "user_id", "users", "id", "SET NULL"),
    ("elections", "created_by", "users", "id", "SET NULL"),
    ("elections", "organization_id", "organizations", "id", "CASCADE"),
    ("event_rsvps", "event_id", "events", "id", "CASCADE"),
    ("event_rsvps", "user_id", "users", "id", "CASCADE"),
    ("events", "organization_id", "organizations", "id", "CASCADE"),
    ("issuance_allowances", "role_id", "positions", "id", "CASCADE"),
    ("shifts", "shift_officer_id", "users", "id", "SET NULL"),
    ("votes", "candidate_id", "candidates", "id", "CASCADE"),
    ("votes", "election_id", "elections", "id", "CASCADE"),
    ("votes", "proxy_voter_id", "users", "id", "SET NULL"),
    ("votes", "voter_id", "users", "id", "SET NULL"),
    ("voting_tokens", "election_id", "elections", "id", "CASCADE"),
]

_FIND_FKS = sa.text("""
    SELECT k.CONSTRAINT_NAME AS name, r.DELETE_RULE AS delete_rule
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA = DATABASE()
      AND k.TABLE_NAME = :table
      AND k.COLUMN_NAME = :column
      AND k.REFERENCED_TABLE_NAME = :referred_table
    """)


def _rebuild(table, column, referred_table, referred_column, ondelete) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table(table) or not inspector.has_table(referred_table):
        return
    if column not in {c["name"] for c in inspector.get_columns(table)}:
        return

    # Matches NAMING_CONVENTION["fk"] in app/core/database.py.
    canonical = f"fk_{table}_{column}_{referred_table}"

    existing = bind.execute(
        _FIND_FKS,
        {"table": table, "column": column, "referred_table": referred_table},
    ).fetchall()

    # Already exactly one constraint, correctly named and ruled — leave it be.
    if (
        len(existing) == 1
        and existing[0].name == canonical
        and existing[0].delete_rule.upper() == ondelete
    ):
        return

    for row in existing:
        op.drop_constraint(row.name, table, type_="foreignkey")

    op.create_foreign_key(
        canonical,
        table,
        referred_table,
        [column],
        [referred_column],
        ondelete=ondelete,
    )


def upgrade() -> None:
    for entry in _FOREIGN_KEYS:
        _rebuild(*entry)


def downgrade() -> None:
    # Restoring RESTRICT would re-break the deletes this revision fixes, and
    # the duplicate constraints it collapsed were never intentional.
    pass
