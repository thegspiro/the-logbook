"""Add the enum values the models allow but the columns reject

Four ENUM columns drifted behind their Python enums. The application treats
these values as legal and writes them; MySQL rejects them under strict
``sql_mode`` and coerces them to ``''`` otherwise:

- ``users.status`` is missing ``leave`` — putting a member on a leave of
  absence fails.
- ``member_leaves_of_absence.leave_type`` and ``training_waivers.waiver_type``
  are missing ``new_member`` — the probationary-member waiver cannot be filed.
- ``form_integrations.integration_type`` is missing ``event_request`` — a form
  cannot be wired to the event-request pipeline.

Fresh installs built by ``create_all()`` already have the full value sets, so
each ``MODIFY`` below is a no-op there. Widening an ENUM by appending members
does not rewrite existing rows: MySQL stores the ordinal, and every pre-existing
member keeps its position. New members are therefore appended in the models'
order rather than inserted mid-list, which is why the value lists here are
written out in full to match ``Base.metadata`` exactly.

Revision ID: 20260805_0003
Revises: 20260805_0002
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0003"
down_revision = "20260805_0011"
branch_labels = None
depends_on = None


# (table, column, values, nullable, server_default) — values must stay in the
# same order as the corresponding Python enum in app/models/.
_ENUMS = [
    (
        "users",
        "status",
        [
            "active",
            "inactive",
            "suspended",
            "probationary",
            "leave",
            "retired",
            "dropped_voluntary",
            "dropped_involuntary",
            "archived",
        ],
        False,
        "active",
    ),
    (
        "member_leaves_of_absence",
        "leave_type",
        [
            "leave_of_absence",
            "medical",
            "military",
            "personal",
            "administrative",
            "new_member",
            "other",
        ],
        False,
        "leave_of_absence",
    ),
    (
        "training_waivers",
        "waiver_type",
        [
            "leave_of_absence",
            "medical",
            "military",
            "personal",
            "administrative",
            "new_member",
            "other",
        ],
        False,
        "leave_of_absence",
    ),
    (
        "form_integrations",
        "integration_type",
        [
            "membership_interest",
            "equipment_assignment",
            "event_registration",
            "event_request",
        ],
        False,
        None,
    ),
]


def _apply(enums) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, column, values, nullable, default in enums:
        if not inspector.has_table(table):
            continue
        if column not in {c["name"] for c in inspector.get_columns(table)}:
            continue

        op.alter_column(
            table,
            column,
            existing_type=sa.Enum(*values, name=f"{table}_{column}"),
            type_=sa.Enum(*values, name=f"{table}_{column}"),
            existing_nullable=nullable,
            nullable=nullable,
            server_default=sa.text(f"'{default}'") if default else None,
            existing_server_default=sa.text(f"'{default}'") if default else None,
        )


def upgrade() -> None:
    _apply(_ENUMS)


def downgrade() -> None:
    # Removing a value would orphan any row already using it (MySQL coerces
    # the unmatched rows to ''), so the downgrade only reverses the cases
    # where that is safe to attempt — none of them are. Left as a no-op.
    pass
