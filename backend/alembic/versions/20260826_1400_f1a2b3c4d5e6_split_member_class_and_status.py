"""Split membership_type into member_class and member_status.

``membership_type`` held two independent facts in one column: what kind of
member somebody is (operational / administrative / social) and where they sit
on the membership ladder (prospective → probationary → regular → life →
retired). Because the two shared a field, neither could be stated without the
other being lost:

* an **administrative** member had no status — there was no way to record a
  probationary treasurer;
* a **life** member had no class — nothing said whether they still ride;
* and ``ElectionService`` had to define "operational" as
  ``membership_type == "active"``, which silently excludes every probationary
  and life member from a rule that plainly means to include them.

This adds the two columns and backfills them. ``membership_type`` is kept and
kept correct — roughly 160 call sites still read it — and is now derived from
the pair by ``app/utils/membership.derive_membership_type``, reconciled on
every flush by the ``_reconcile_membership`` listener on ``User``.

``honorary`` backfills to the **social** class rather than operational. That is
not a judgement about honorary members; it is what the system already did with
them. ``honorary`` sits in ``DEFAULT_EXCLUDED_MEMBERSHIP_TYPES`` beside
administrative and retired, so an honorary member has never been able to
self-sign up for a shift. Mapping them anywhere else would widen access on
upgrade.

**Reversible.** The downgrade drops both columns; ``membership_type`` is
untouched by the upgrade and still carries every legacy value, so nothing is
lost going back. What a downgrade does discard is any standing entered after
this migration that the legacy vocabulary cannot express — an administrative
probationer reverts to plain "administrative" — which is the same information
loss the old schema had all along.

Revision ID: f1a2b3c4d5e6
Revises: b3e8d1f45a27
Create Date: 2026-08-26 14:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "b3e8d1f45a27"
branch_labels = None
depends_on = None


# --- frozen copy of the split, as of this revision -------------------------
# Inlined rather than imported from app.utils.membership: a migration must keep
# transforming rows the way it did the day it ran, and that helper is free to
# change (CLAUDE.md pitfall #20).
_SPLIT = {
    "prospective": ("operational", "prospective"),
    "probationary": ("operational", "probationary"),
    "active": ("operational", "regular"),
    "life": ("operational", "life"),
    "retired": ("operational", "retired"),
    "administrative": ("administrative", "regular"),
    "honorary": ("social", "honorary"),
}
_DEFAULT = ("operational", "regular")


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # Guarded although a migration does create `users`: a backfill has nothing
    # to rewrite on a database that has not built the table yet, and
    # reflecting an absent one would take down the whole upgrade rather than
    # this step (pitfall #26).
    if not _has_table("users"):
        return

    # Deliberately no server_default. A DDL default would be applied to every
    # raw-SQL insert that names only `membership_type` — and would be wrong for
    # exactly the members who are not plain operational regulars, silently
    # promoting an administrative member into the operational class. NULL is
    # the honest value for "nobody has set this", and readers derive from
    # `membership_type` when they see it (see the fallback in
    # ElectionService._user_has_role_type). ORM writes never leave it NULL:
    # the `_reconcile_membership` listener on User fills both columns before
    # every insert and update.
    if not _has_column("users", "member_class"):
        op.add_column(
            "users",
            sa.Column("member_class", sa.String(length=20), nullable=True),
        )
        op.create_index("ix_users_member_class", "users", ["member_class"])

    if not _has_column("users", "member_status"):
        op.add_column(
            "users",
            sa.Column("member_status", sa.String(length=20), nullable=True),
        )
        op.create_index("ix_users_member_status", "users", ["member_status"])

    bind = op.get_bind()

    # One UPDATE per legacy value rather than per row: there are seven of them
    # and an arbitrary number of members.
    for legacy, (member_class, member_status) in _SPLIT.items():
        bind.execute(
            sa.text(
                "UPDATE users SET member_class = :cls, member_status = :status "
                "WHERE LOWER(TRIM(COALESCE(membership_type, ''))) = :legacy"
            ),
            {"cls": member_class, "status": member_status, "legacy": legacy},
        )

    # A member with nothing recorded is a regular operational one: the column
    # defaults to "active", so an empty value means the default rather than
    # something unknown.
    bind.execute(
        sa.text(
            "UPDATE users SET member_class = :cls, member_status = :status "
            "WHERE TRIM(COALESCE(membership_type, '')) = ''"
        ),
        {"cls": _DEFAULT[0], "status": _DEFAULT[1]},
    )

    # Everything else that is still NULL is left NULL, deliberately.
    #
    # `membership_type` also stores org-configurable **membership tier ids** —
    # `POST /member-status/.../tier` validates the id against
    # organization.settings["membership_tiers"] and writes it straight into
    # this column, and the shipped defaults already include "senior". Those
    # members satisfied neither an "operational" ballot restriction (which
    # meant membership_type == "active") nor a "regular" one (in active, life).
    #
    # Defaulting them to operational/regular here would silently enrol every
    # custom tier — senior, associate, cadet, whatever a department has
    # configured — in ballots restricted to the operational regular body. NULL
    # matches no class and no status, which is exactly their prior behaviour,
    # and the readers derive from `membership_type` when they see it.


def downgrade() -> None:
    if not _has_table("users"):
        return
    if _has_column("users", "member_status"):
        op.drop_index("ix_users_member_status", table_name="users")
        op.drop_column("users", "member_status")
    if _has_column("users", "member_class"):
        op.drop_index("ix_users_member_class", table_name="users")
        op.drop_column("users", "member_class")
