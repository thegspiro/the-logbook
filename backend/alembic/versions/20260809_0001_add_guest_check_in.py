"""Add guest (non-member) QR check-in columns

Room QR codes previously pointed only at ``/events/{id}/check-in``, an
authenticated route, so a visitor at a volunteer interest night had no way to
record their own attendance. Three columns back the guest path:

* ``events.allow_guest_check_in`` — per-event opt-in gate. Off by default,
  because enabling it exposes an unauthenticated write endpoint.
* ``events.guest_check_in_creates_prospect`` — whether a guest sign-in also
  opens a prospective-member record for the recruitment pipeline.
* ``event_external_attendees.prospect_id`` — links the attendance row to the
  prospect it created, so coordinators can move between the two.

Revision ID: 20260809_0001
Revises: 20260808_0003
Create Date: 2026-08-09 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "20260809_0001"
down_revision = "20260808_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if inspector.has_table("events"):
        columns = {c["name"] for c in inspector.get_columns("events")}
        if "allow_guest_check_in" not in columns:
            op.add_column(
                "events",
                sa.Column(
                    "allow_guest_check_in",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )
        if "guest_check_in_creates_prospect" not in columns:
            op.add_column(
                "events",
                sa.Column(
                    "guest_check_in_creates_prospect",
                    sa.Boolean(),
                    nullable=False,
                    server_default="0",
                ),
            )

    if not inspector.has_table("event_external_attendees"):
        return

    columns = {c["name"] for c in inspector.get_columns("event_external_attendees")}
    if "prospect_id" in columns:
        return

    op.add_column(
        "event_external_attendees",
        sa.Column("prospect_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_ext_attendees_prospect_id",
        "event_external_attendees",
        ["prospect_id"],
    )

    # The FK only makes sense where the pipeline tables exist. Installs that
    # predate the membership pipeline still get the column and index, so the
    # ORM mapping stays valid either way.
    if inspector.has_table("prospective_members"):
        op.create_foreign_key(
            "fk_ext_attendees_prospect_id",
            "event_external_attendees",
            "prospective_members",
            ["prospect_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if inspector.has_table("event_external_attendees"):
        columns = {c["name"] for c in inspector.get_columns("event_external_attendees")}
        if "prospect_id" in columns:
            fks = {
                fk["name"]
                for fk in inspector.get_foreign_keys("event_external_attendees")
            }
            if "fk_ext_attendees_prospect_id" in fks:
                op.drop_constraint(
                    "fk_ext_attendees_prospect_id",
                    "event_external_attendees",
                    type_="foreignkey",
                )
            indexes = {
                ix["name"] for ix in inspector.get_indexes("event_external_attendees")
            }
            if "ix_ext_attendees_prospect_id" in indexes:
                op.drop_index(
                    "ix_ext_attendees_prospect_id",
                    table_name="event_external_attendees",
                )
            op.drop_column("event_external_attendees", "prospect_id")

    if inspector.has_table("events"):
        columns = {c["name"] for c in inspector.get_columns("events")}
        if "guest_check_in_creates_prospect" in columns:
            op.drop_column("events", "guest_check_in_creates_prospect")
        if "allow_guest_check_in" in columns:
            op.drop_column("events", "allow_guest_check_in")
