"""training record match keys and fallback name cutoff

Two owner decisions of 2026-11-01 about how a training requirement finds the
records that satisfy it.

**Stored match key.** Certification requirements matched records by text: the
requirement's name as a case-insensitive substring of the course name, its
registry code as a substring of the certification number. SQL could not ask
that question the way Python answered it (``LIKE`` folds case by collation),
so grading read every member's whole completed history. Each record now
carries ``match_key`` (from ``course_name``) and ``certification_key`` (from
``certification_number``), indexed with ``user_id``, and grading compares keys.

**Extend the cut-off.** Skills-evaluation, checklist and knowledge-test
requirements — every type the grader's fallback branch handles — matched by
name with no date limit. They now follow the certification rule: only a record
dated on or before the requirement's ``name_match_until`` matches by name.

Backfill, in this order:

1. Every existing record is keyed with the normalization frozen below
   (``_key``): NFKC, case fold, NFKC, then only letters and digits, cut to 255.
   It is a copy of ``app/utils/training_match_key.training_match_key`` as it
   was the day this ran, inlined so later edits to the helper cannot change
   what this migration does (CLAUDE.md pitfall #20). A record whose text has
   no letter or digit gets NULL and can match only by linked course or
   training type; so does a certification number that is empty.
2. ``name_match_until`` is set to the day this runs (UTC) on every existing
   requirement graded by the fallback branch — any type other than hours,
   courses, certification, shifts and calls — replacing what is there. The
   date migration ``60aaf273de27`` stored on those rows was the day the
   *certification* rule changed; the fallback types kept matching by name
   until today, so a record graded under that rule before this upgrade keeps
   its name credit, whenever the upgrade happens. Requirements created
   afterwards keep NULL: no name matching. Certification rows are untouched.

**Reversible, with one loss.** The downgrade drops the indexes and columns.
It does not restore the fallback requirements' earlier ``name_match_until``:
the previous code never read it for those types, so nothing changes by
leaving today's date. A later re-upgrade re-keys every record and moves those
dates to the day it runs.

Revision ID: bd8fc0c4a941
Revises: c4ee38cd931c
Create Date: 2026-11-04 17:03:10.937909

"""

import unicodedata
from datetime import datetime, timezone
from typing import Optional, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bd8fc0c4a941"
down_revision: Union[str, None] = "c4ee38cd931c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
RECORDS_TABLE = "training_records"
REQUIREMENTS_TABLE = "training_requirements"

_KEY_LENGTH = 255
# key column -> its (user_id, key) index
_COLUMNS = {
    "match_key": "idx_record_user_match_key",
    "certification_key": "idx_record_user_certification_key",
}
# The types _grade_member_requirement grades in a typed branch; every other
# type falls through to the fallback branch's name match.
_TYPED_TYPES = ("hours", "courses", "certification", "shifts", "calls")
_BATCH = 1000


def _key(text: Optional[str]) -> Optional[str]:
    """Frozen copy of ``training_match_key`` — do not import the helper."""
    if not text:
        return None
    folded = unicodedata.normalize(
        "NFKC", unicodedata.normalize("NFKC", text).casefold()
    )
    key = "".join(ch for ch in folded if ch.isalnum())[:_KEY_LENGTH]
    return key or None


def _columns(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _indexes(table: str) -> set:
    inspector = sa.inspect(op.get_bind())
    return {ix["name"] for ix in inspector.get_indexes(table)}


def _backfill_keys() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"SELECT id, course_name, certification_number FROM {RECORDS_TABLE} "
            "WHERE match_key IS NULL "
            "OR (certification_key IS NULL AND certification_number IS NOT NULL)"
        )
    ).all()
    update = sa.text(
        f"UPDATE {RECORDS_TABLE} SET match_key = :match_key, "
        "certification_key = :certification_key WHERE id = :id"
    )
    params = [
        {
            "id": row.id,
            "match_key": _key(row.course_name),
            "certification_key": _key(row.certification_number),
        }
        for row in rows
    ]
    for start in range(0, len(params), _BATCH):
        bind.execute(update, params[start : start + _BATCH])


def upgrade() -> None:
    # training_records is created by 20260118_0003, but guard anyway: startup's
    # create_all and column repair can build the columns first (pitfall #26),
    # and a table create_all builds later comes from the model, keys included.
    columns = _columns(RECORDS_TABLE)
    if columns:
        for column in _COLUMNS:
            if column not in columns:
                op.add_column(
                    RECORDS_TABLE,
                    sa.Column(column, sa.String(length=_KEY_LENGTH), nullable=True),
                )
        indexes = _indexes(RECORDS_TABLE)
        for column, index in _COLUMNS.items():
            if index not in indexes:
                op.create_index(index, RECORDS_TABLE, ["user_id", column])
        _backfill_keys()

    if "name_match_until" in _columns(REQUIREMENTS_TABLE):
        placeholders = ", ".join(f":t{i}" for i in range(len(_TYPED_TYPES)))
        op.execute(
            sa.text(
                f"UPDATE {REQUIREMENTS_TABLE} SET name_match_until = :cutoff "
                f"WHERE requirement_type NOT IN ({placeholders})"
            ).bindparams(
                cutoff=datetime.now(timezone.utc).date(),
                **{f"t{i}": t for i, t in enumerate(_TYPED_TYPES)},
            )
        )


def downgrade() -> None:
    columns = _columns(RECORDS_TABLE)
    if not columns:
        return
    indexes = _indexes(RECORDS_TABLE)
    for column, index in _COLUMNS.items():
        if index in indexes:
            op.drop_index(index, table_name=RECORDS_TABLE)
        if column in columns:
            op.drop_column(RECORDS_TABLE, column)
