"""Minutes adoption, member suggestions, closed sessions, motion-to-ballot links

* ``meeting_minutes.adopted_on`` / ``adopted_as_amended`` /
  ``adopting_minutes_id`` — what the body did when it adopted the minutes, and
  at which meeting. ``adopting_minutes_id`` is a self key that goes NULL if the
  adopting meeting's minutes are deleted.
* ``meeting_motions.election_id`` / ``ballot_item_id`` — the ballot that decided
  a motion.
* ``minutes_election_results.is_addendum`` — a result filed once the minutes
  were submitted. Existing rows were all filed while the minutes were a draft,
  so the server default of 0 is accurate for them.
* ``minutes_closed_sessions`` — who was in a closed session, when, and why.
* ``minutes_suggestions`` — changes members propose while minutes circulate.

Nothing is backfilled: none of this existed. Any altered table may be built by
``create_all`` rather than a migration, so each step is skipped when its table
is absent, and a new table is only created once the tables its keys point at
exist.

The downgrade drops the two tables and the columns. Closed-session records,
member suggestions, adoption details and motion ballot links are lost with
them; a result filed as an addendum becomes indistinguishable from one filed
while a draft.

Revision ID: f2c5e55e7dda
Revises: 8efc77d4c0c3
Create Date: 2026-10-14 18:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2c5e55e7dda"
down_revision: Union[str, None] = "8efc77d4c0c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MINUTES = "meeting_minutes"
MOTIONS = "meeting_motions"
RESULTS = "minutes_election_results"
SESSIONS = "minutes_closed_sessions"
SUGGESTIONS = "minutes_suggestions"

# The names the models' naming convention gives these, so the downgrade finds
# them however the table was built.
ADOPTING_FK = "fk_meeting_minutes_adopting_minutes_id_meeting_minutes"
MOTION_FK = "fk_meeting_motions_election_id_elections"
MOTION_IX = "ix_meeting_motions_election_id"


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _has_fk(table: str, name: str) -> bool:
    return name in {fk.get("name") for fk in _inspector().get_foreign_keys(table)}


def _has_index(table: str, name: str) -> bool:
    return name in {ix.get("name") for ix in _inspector().get_indexes(table)}


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def _org_fk() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )


def _minutes_fk() -> sa.Column:
    return sa.Column(
        "minutes_id",
        sa.String(36),
        sa.ForeignKey(f"{MINUTES}.id", ondelete="CASCADE"),
        nullable=False,
    )


def _stamps() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    if not _has_table(MINUTES):
        return

    existing = _columns(MINUTES)
    if "adopted_on" not in existing:
        op.add_column(
            MINUTES,
            sa.Column("adopted_on", sa.DateTime(timezone=True), nullable=True),
        )
    if "adopted_as_amended" not in existing:
        op.add_column(
            MINUTES, sa.Column("adopted_as_amended", sa.Boolean(), nullable=True)
        )
    if "adopting_minutes_id" not in existing:
        op.add_column(
            MINUTES, sa.Column("adopting_minutes_id", sa.String(36), nullable=True)
        )
    if not _has_fk(MINUTES, ADOPTING_FK):
        op.create_foreign_key(
            ADOPTING_FK,
            MINUTES,
            MINUTES,
            ["adopting_minutes_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if _has_table(MOTIONS):
        existing = _columns(MOTIONS)
        if "election_id" not in existing:
            op.add_column(
                MOTIONS, sa.Column("election_id", sa.String(36), nullable=True)
            )
        if "ballot_item_id" not in existing:
            op.add_column(
                MOTIONS, sa.Column("ballot_item_id", sa.String(100), nullable=True)
            )
        if not _has_index(MOTIONS, MOTION_IX):
            op.create_index(MOTION_IX, MOTIONS, ["election_id"])
        if _has_table("elections") and not _has_fk(MOTIONS, MOTION_FK):
            op.create_foreign_key(
                MOTION_FK,
                MOTIONS,
                "elections",
                ["election_id"],
                ["id"],
                ondelete="SET NULL",
            )

    if _has_table(RESULTS) and "is_addendum" not in _columns(RESULTS):
        op.add_column(
            RESULTS,
            sa.Column(
                "is_addendum",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )

    if not _has_table(SESSIONS) and _has_table(MOTIONS):
        op.create_table(
            SESSIONS,
            sa.Column("id", sa.String(36), primary_key=True),
            _minutes_fk(),
            _org_fk(),
            sa.Column(
                "motion_id",
                sa.String(36),
                sa.ForeignKey(f"{MOTIONS}.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("reason", sa.String(300), nullable=False),
            sa.Column("legal_basis", sa.String(300), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("participants", sa.JSON(), nullable=True),
            sa.Column("summary", sa.Text(), nullable=True),
            _user_fk("created_by"),
            *_stamps(),
            sa.Index("ix_minutes_closed_sessions_minutes_id", "minutes_id"),
            sa.Index("ix_minutes_closed_sessions_organization_id", "organization_id"),
        )

    if not _has_table(SUGGESTIONS):
        op.create_table(
            SUGGESTIONS,
            sa.Column("id", sa.String(36), primary_key=True),
            _minutes_fk(),
            _org_fk(),
            sa.Column("section_key", sa.String(100), nullable=True),
            sa.Column("comment", sa.Text(), nullable=False),
            sa.Column("proposed_text", sa.Text(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("resolution_note", sa.Text(), nullable=True),
            _user_fk("resolved_by"),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            _user_fk("created_by"),
            *_stamps(),
            sa.Index("ix_minutes_suggestions_minutes_id", "minutes_id"),
            sa.Index("ix_minutes_suggestions_organization_id", "organization_id"),
            sa.Index("ix_minutes_suggestions_created_by", "created_by"),
        )


def downgrade() -> None:
    for table in (SUGGESTIONS, SESSIONS):
        op.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))

    if _has_table(RESULTS) and "is_addendum" in _columns(RESULTS):
        op.drop_column(RESULTS, "is_addendum")

    if _has_table(MOTIONS):
        if _has_fk(MOTIONS, MOTION_FK):
            op.drop_constraint(MOTION_FK, MOTIONS, type_="foreignkey")
        if _has_index(MOTIONS, MOTION_IX):
            op.drop_index(MOTION_IX, table_name=MOTIONS)
        existing = _columns(MOTIONS)
        for name in ("ballot_item_id", "election_id"):
            if name in existing:
                op.drop_column(MOTIONS, name)

    if _has_table(MINUTES):
        if _has_fk(MINUTES, ADOPTING_FK):
            op.drop_constraint(ADOPTING_FK, MINUTES, type_="foreignkey")
        existing = _columns(MINUTES)
        for name in ("adopting_minutes_id", "adopted_as_amended", "adopted_on"):
            if name in existing:
                op.drop_column(MINUTES, name)
