"""Add parent_room_id to facility_rooms for nested rooms

Lets a room live inside another room — e.g. a quartermaster's storage space
within the volunteer office — instead of forcing every space in a building to
sit in one flat list.

ON DELETE SET NULL (never CASCADE): removing a room must not silently delete
the sub-rooms hanging off it. The service re-parents children onto the deleted
room's own parent; this constraint is the database-level backstop.

Revision ID: 20260816_0001
Revises: 20260814_0004
Create Date: 2026-08-16
"""

import sqlalchemy as sa
from alembic import op

revision = "20260816_0001"
down_revision = "20260814_0004"
branch_labels = None
depends_on = None

_FK_NAME = "fk_facility_rooms_parent_room"
# The model declares parent_room_id with index=True, which the metadata naming
# convention ("ix_%(column_0_label)s" in app/core/database.py) materializes as
# ix_facility_rooms_parent_room_id on a create_all()-built database. An early
# build of this migration created idx_facility_rooms_parent instead; installs
# that already ran it keep that name (either satisfies the guard below), while
# fresh runs create the convention-conforming name so migration-built and
# create_all()-built schemas no longer diverge.
_INDEX_NAME = "ix_facility_rooms_parent_room_id"
_LEGACY_INDEX_NAME = "idx_facility_rooms_parent"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "facility_rooms" not in inspector.get_table_names():
        return

    # Guard the column, index, and FK independently instead of returning early
    # when the column exists: MySQL DDL is non-transactional, so a failure
    # after add_column but before the index/FK would otherwise let a retry
    # skip straight past — marking this revision complete without the index or
    # the ON DELETE SET NULL backstop. (The downgrade below is guarded the
    # same way.)
    columns = {col["name"] for col in inspector.get_columns("facility_rooms")}
    if "parent_room_id" not in columns:
        op.add_column(
            "facility_rooms", sa.Column("parent_room_id", sa.String(36), nullable=True)
        )

    index_names = {ix["name"] for ix in inspector.get_indexes("facility_rooms")}
    if not index_names & {_INDEX_NAME, _LEGACY_INDEX_NAME}:
        op.create_index(_INDEX_NAME, "facility_rooms", ["parent_room_id"])

    fk_names = {fk["name"] for fk in inspector.get_foreign_keys("facility_rooms")}
    if _FK_NAME not in fk_names:
        op.create_foreign_key(
            _FK_NAME,
            "facility_rooms",
            "facility_rooms",
            ["parent_room_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "facility_rooms" not in inspector.get_table_names():
        return

    columns = {col["name"] for col in inspector.get_columns("facility_rooms")}
    if "parent_room_id" not in columns:
        return

    # Drop the FK before the index: MySQL requires an index backing an active
    # foreign key, so the reverse order fails.
    fk_names = {fk["name"] for fk in inspector.get_foreign_keys("facility_rooms")}
    if _FK_NAME in fk_names:
        op.drop_constraint(_FK_NAME, "facility_rooms", type_="foreignkey")

    index_names = {ix["name"] for ix in inspector.get_indexes("facility_rooms")}
    for index_name in (_INDEX_NAME, _LEGACY_INDEX_NAME):
        if index_name in index_names:
            op.drop_index(index_name, table_name="facility_rooms")

    op.drop_column("facility_rooms", "parent_room_id")
