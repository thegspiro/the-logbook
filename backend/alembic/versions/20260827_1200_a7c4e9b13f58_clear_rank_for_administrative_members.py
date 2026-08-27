"""Clear the operational rank of every administrative member.

An operational rank is a chain-of-command position, and it is not decoration:
``_collect_user_permissions`` in ``app/api/dependencies.py`` unions
``get_rank_default_permissions(user.rank)`` into a member's effective
permissions. Until this change nothing stopped a member from being
Administrative *and* Fire Chief at once, so an administrative member could hold
``settings.manage``/``security.manage`` through a chain of command they are by
definition outside of.

The application now refuses that pair on every write path, but a rule enforced
only on writes leaves every installation that already ran onboarding carrying
the grant indefinitely — the same "a seeded grant reaches the database and stays
there" trap that ``20260824_2140_31e2816df7c3`` was written for. This settles
the rows already stored.

Two spellings, one fact
-----------------------
``member_class`` is the authority, but it is nullable and was only backfilled by
``f1a2b3c4d5e6``; a row written by a path that names only the legacy
``membership_type`` can still have it NULL. So both are consulted, in the same
precedence ``app/utils/membership.effective_member_class`` uses: the class when
it is set, the legacy field otherwise.

Only ``administrative`` is cleared. Deliberately **not** "everything that is not
operational": ``membership_type`` doubles as an org-configurable membership
*tier* id, and ``split_membership_type`` resolves an unrecognised tier (the
shipped defaults already include ``senior``) to no class at all. Sweeping on
"not operational" would strip the rank of every member on a custom tier in every
department that configured one.

**Irreversible.** The downgrade is a no-op: the rank each member held is not
recorded anywhere else, so it cannot be put back. Reverting the application code
without reverting this migration is safe — the rows are simply already
compliant — but the cleared ranks must be re-entered by hand.

``rank`` is a reserved word, and only on one of the two engines
--------------------------------------------------------------
MySQL reserved ``RANK`` in 8.0.2 for the window function; MariaDB 10.11 did
not. So an unquoted ``SET rank = NULL`` parses on MariaDB and is a 1064 syntax
error on MySQL — a hand-written statement passes local testing against one
engine and takes out the other half of the CI matrix.

Hence SQLAlchemy Core rather than ``sa.text``: the dialect quotes the
identifier, so this cannot depend on which engine happened to run it. Any
future migration naming this column must do the same, or backtick it.

Revision ID: a7c4e9b13f58
Revises: d4e5f6a7b8c9
Create Date: 2026-08-27 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "a7c4e9b13f58"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None

_ADMINISTRATIVE = "administrative"

# A minimal stand-in for the real table: a migration must keep transforming rows
# the way it did the day it ran, so it cannot import the model, which is free to
# change underneath it.
_users = sa.table(
    "users",
    sa.column("rank", sa.String),
    sa.column("member_class", sa.String),
    sa.column("membership_type", sa.String),
)


def upgrade() -> None:
    op.execute(
        _users.update()
        .where(
            _users.c.rank.isnot(None),
            sa.or_(
                _users.c.member_class == _ADMINISTRATIVE,
                sa.and_(
                    _users.c.member_class.is_(None),
                    _users.c.membership_type == _ADMINISTRATIVE,
                ),
            ),
        )
        .values(rank=None)
    )


def downgrade() -> None:
    """No-op. See the module docstring: the cleared ranks are not recoverable."""
