"""cohort missed classes and make-up link

W27-3: a member added to a running cohort is RSVP'd only to the classes still
to come, so each class held before they joined needs an officer's decision —
credit it, or schedule a make-up session for that member alone.

* ``course_cohort_missed_classes`` records that decision, one row per member
  and class. Nothing to backfill: a class with no row is still undecided.
* ``course_cohort_classes.makeup_for_class_id`` marks a make-up session, so it
  is never itself counted as a class a later joiner missed. Existing classes
  are all regular classes, so NULL is right for every row already there.

Revision ID: d4d0a483cdd5
Revises: 99b16109d44c
Create Date: 2026-10-05 16:24:58.695689

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4d0a483cdd5"
down_revision: Union[str, None] = "99b16109d44c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK_NAME = "fk_cohort_class_makeup_for"


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    tables = _tables()
    # A fresh install builds both from the models via create_all before
    # stamping head; only an upgrading one needs them here.
    if "course_cohort_classes" in tables and "makeup_for_class_id" not in _columns(
        "course_cohort_classes"
    ):
        op.add_column(
            "course_cohort_classes",
            sa.Column("makeup_for_class_id", sa.String(36), nullable=True),
        )
        op.create_foreign_key(
            _FK_NAME,
            "course_cohort_classes",
            "course_cohort_classes",
            ["makeup_for_class_id"],
            ["id"],
            ondelete="SET NULL",
        )

    required = {
        "organizations",
        "course_cohorts",
        "course_cohort_members",
        "course_cohort_classes",
        "training_records",
        "users",
    }
    if "course_cohort_missed_classes" in tables or not required <= tables:
        return
    op.create_table(
        "course_cohort_missed_classes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "cohort_id",
            sa.String(36),
            sa.ForeignKey("course_cohorts.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "cohort_member_id",
            sa.String(36),
            sa.ForeignKey("course_cohort_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "cohort_class_id",
            sa.String(36),
            sa.ForeignKey("course_cohort_classes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resolution",
            sa.Enum("credited", "makeup_scheduled", name="missedclassresolution"),
            nullable=False,
        ),
        sa.Column(
            "training_record_id",
            sa.String(36),
            sa.ForeignKey("training_records.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "makeup_class_id",
            sa.String(36),
            sa.ForeignKey("course_cohort_classes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recorded_by",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "cohort_member_id", "cohort_class_id", name="uq_cohort_missed_class"
        ),
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS course_cohort_missed_classes")
    tables = _tables()
    if "course_cohort_classes" in tables and "makeup_for_class_id" in _columns(
        "course_cohort_classes"
    ):
        fks = {
            fk["name"]
            for fk in sa.inspect(op.get_bind()).get_foreign_keys(
                "course_cohort_classes"
            )
        }
        if _FK_NAME in fks:
            op.drop_constraint(_FK_NAME, "course_cohort_classes", type_="foreignkey")
        op.drop_column("course_cohort_classes", "makeup_for_class_id")
