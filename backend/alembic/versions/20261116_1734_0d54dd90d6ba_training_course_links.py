"""Training course links, so a link can be undone

Training Admin -> Curriculum -> Course Links sets a library course, with its
category and training type, on every unlinked training record that carries a
name. One "Link all suggested" can change hundreds of records, so each link
is now kept with what every record held before, and an officer can unlink it
(owner decision 2026-11-16).

New tables, both additive:

* ``training_course_links`` — one row per link: the course, the name, how many
  records it changed, who linked it and when, and who unlinked it and when.
* ``training_course_link_records`` — each record a link changed, with the
  category and training type it had before. Unique on (link, record).

No existing table or row changes. Links made before this revision were not
recorded and cannot be unlinked from the screen. Each table is created only
when absent, so a database whose tables ``create_all`` already built upgrades
cleanly.

The downgrade drops both tables, losing the link history; the records keep
their courses either way.

Revision ID: 0d54dd90d6ba
Revises: bbeb4867d393
Create Date: 2026-11-16 17:34:05.459519

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d54dd90d6ba"
down_revision: Union[str, None] = "bbeb4867d393"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LINKS = "training_course_links"
LINK_RECORDS = "training_course_link_records"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    # The tables these refer to may be ones only create_all builds (pitfall
    # #26); create_all then builds these from the models too.
    if not all(
        _has_table(t)
        for t in ("organizations", "users", "training_courses", "training_records")
    ):
        return

    if not _has_table(LINKS):
        op.create_table(
            LINKS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "organization_id",
                sa.String(36),
                sa.ForeignKey("organizations.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "course_id",
                sa.String(36),
                sa.ForeignKey("training_courses.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("course_name", sa.String(255), nullable=False),
            sa.Column("name_key", sa.String(255), nullable=False),
            sa.Column("label", sa.String(255), nullable=False),
            sa.Column("record_count", sa.Integer(), nullable=False),
            sa.Column(
                "linked_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "linked_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "undone_by",
                sa.String(36),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_training_course_links_org_linked",
            LINKS,
            ["organization_id", "linked_at"],
        )

    if not _has_table(LINK_RECORDS):
        op.create_table(
            LINK_RECORDS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "link_id",
                sa.String(36),
                sa.ForeignKey(f"{LINKS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "record_id",
                sa.String(36),
                sa.ForeignKey("training_records.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("previous_category_id", sa.String(36), nullable=True),
            sa.Column("previous_training_type", sa.String(50), nullable=True),
            sa.UniqueConstraint(
                "link_id",
                "record_id",
                name="uq_training_course_link_records_link_record",
            ),
        )
        op.create_index(
            "ix_training_course_link_records_record", LINK_RECORDS, ["record_id"]
        )


def downgrade() -> None:
    if _has_table(LINK_RECORDS):
        op.drop_table(LINK_RECORDS)
    if _has_table(LINKS):
        op.drop_table(LINKS)
