"""Make facility_emergency_contacts.company_name nullable

The shipped ContactsSection.tsx form's own validation rule accepts a
contact-name-only record (e.g. a facility's own on-call staff, with no
vendor company behind them) — it only requires that company_name or
contact_name be present, not both. FacilityEmergencyContactCreate carried
that same "at least one" rule at the Pydantic level, but company_name was
still `nullable=False` on the model, so a contact-name-only submission
still hit a database NOT NULL failure the schema no longer rejected first.

FacilityEmergencyContactCreate.require_company_or_contact_name is the
invariant going forward; this migration relaxes the column so the model
can represent the rows that validator now allows, and also normalizes any
existing empty-string company_name to NULL. The column was NOT NULL with
no min_length, so an existing caller sending company_name="" (the only way
to functionally "blank" a required-but-uncleared field before this
migration) already passed both the old schema and the database — leaving
company_name and NULL as two different on-disk spellings of "no company
name" a reader would otherwise have to know to treat the same. Since NULL
is what every write path uses for that meaning going forward, existing ""
rows are folded into it rather than left as a second, undocumented shape
(CLAUDE.md pitfall #20's "one canonical stored shape" applied to a scalar
column, not just a JSON one).

Guarded on the table existing: fresh installs come up through create_all
+ stamp-head rather than this chain (CLAUDE.md pitfall #26), so a database
can reach this revision without the table having been built by a
migration. In this repo's history the table is always migration-built
(20260214_2100_add_facilities_extended_tables), but the guard costs
nothing and keeps this migration consistent with the others in the chain.
"""

import sqlalchemy as sa
from alembic import op

revision = "f1565c64b658"
down_revision = "a3f61c8d27b4"
branch_labels = None
depends_on = None

_TABLE = "facility_emergency_contacts"
_COLUMN = "company_name"


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column(_TABLE, _COLUMN):
        return

    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=sa.String(200),
        nullable=True,
    )
    op.execute(f"UPDATE {_TABLE} SET {_COLUMN} = NULL WHERE {_COLUMN} = ''")


def downgrade() -> None:
    if not _has_column(_TABLE, _COLUMN):
        return

    # Any contact-name-only rows written under the relaxed constraint would
    # violate NOT NULL on downgrade; there is no company name to backfill
    # from, so downgrading a database holding such rows must fail loudly
    # rather than corrupt them with a placeholder value.
    op.alter_column(
        _TABLE,
        _COLUMN,
        existing_type=sa.String(200),
        nullable=False,
    )
