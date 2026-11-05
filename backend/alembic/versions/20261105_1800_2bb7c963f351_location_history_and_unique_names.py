"""Keep training, meeting and request locations; make location names unique

Revision ID: 2bb7c963f351
Revises: d1165a97b48e
Create Date: 2026-11-05 18:00:00.000000

Two owner decisions of 2026-11-01 about locations (KNOWN_LIMITATIONS,
"Locations — Deleting One Clears Its Location From Nine Kinds of Records" and
"LOC-40 / LOC-41").

**1. Deleting a location no longer clears it from training history, meetings
or event requests.** ``training_records``, ``course_classes``,
``course_cohorts``, ``course_cohort_classes`` and ``meetings`` (``location_id``)
and ``event_requests`` (``event_location_id``) change from ``ON DELETE SET
NULL`` to ``ON DELETE RESTRICT``, as ``events.location_id`` already is.
``LocationService`` counts these columns and deactivates a referenced location
rather than deleting it; RESTRICT is what refuses a reference that races in
after that count, instead of silently nulling it. ``inventory_items``,
``storage_areas`` and ``nfc_card_taps`` are untouched and keep clearing.
Constraint names are read from information_schema, since they differ between
installations built by ``create_all`` and by migrations; the replacement key
takes the models' naming convention. No row changes.

**2. LOC-41: (organization, name, building) is unique in the database.** The
rule lived only in ``LocationService`` as an unlocked read-then-write, so two
simultaneous creates could both pass it. A unique index lets NULLs repeat, so a
key on ``building`` itself would not cover locations with no building — the
case the service check handles with its own ``IS NULL`` branch, and the
commonest one (every station onboarding creates has none). So a stored
generated column ``building_key = COALESCE(building, '')`` is added and the key
is ``uq_locations_org_name_building (organization_id, name, building_key)``.
That makes "no building" and an empty building one scope, which the service now
also treats as one (it already sent an empty building down its ``IS NULL``
branch, so only rows written around the API could differ). Equality is the
column collation's (``utf8mb4_unicode_ci``): "Bunk Room" and "bunk room " are
the same name, to the key as to the service check.

**Existing duplicates are renamed first (Pitfall #35)**, or creating the key
would fail on them and the backend would not boot. Within each duplicate group
the oldest row (``created_at``, then ``id``) keeps its name; each later row
gets `` (2)``, `` (3)``, ... appended to its own name, skipping any number a
location in that building already holds, and cutting the name so it still fits
200 characters. Facility room locations are renamed the same way, and the room
sync numbers a clashing room location identically from now on, so a renamed
one keeps its number on its next save. The renaming is **not reversed** by the
downgrade: nothing records which rows were renamed, and the old names would be
ambiguous again. Rows are renamed, never merged or deleted, so nothing that
points at a location is touched.

Safe to run twice: a second run finds no duplicates, and the column, key and
RESTRICT foreign keys are each created only when absent. A table ``create_all``
has not built yet is skipped (Pitfall #26) — ``event_requests`` is one — since
it will be built from the models, which declare the new shape.

Downgrade drops the key and ``building_key`` and puts the six foreign keys back
to ``ON DELETE SET NULL``.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2bb7c963f351"
down_revision: Union[str, None] = "d1165a97b48e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
_LOCATIONS = "locations"
_PROTECTED = [
    ("training_records", "location_id"),
    ("course_classes", "location_id"),
    ("course_cohorts", "location_id"),
    ("course_cohort_classes", "location_id"),
    ("meetings", "location_id"),
    ("event_requests", "event_location_id"),
]

_KEY_COLUMN = "building_key"
_CONSTRAINT = "uq_locations_org_name_building"
_NAME_MAX = 200


def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _has_constraint() -> bool:
    inspector = sa.inspect(op.get_bind())
    names = {c["name"] for c in inspector.get_unique_constraints(_LOCATIONS)}
    names |= {i["name"] for i in inspector.get_indexes(_LOCATIONS) if i["unique"]}
    return _CONSTRAINT in names


def _location_fks(table: str, column: str) -> list[tuple[str, str]]:
    """(constraint name, delete rule) of every key from table.column to locations."""
    rows = op.get_bind().execute(
        sa.text(
            "SELECT k.constraint_name, r.delete_rule "
            "FROM information_schema.key_column_usage k "
            "JOIN information_schema.referential_constraints r "
            "  ON r.constraint_schema = k.constraint_schema "
            " AND r.constraint_name = k.constraint_name "
            " AND r.table_name = k.table_name "
            "WHERE k.table_schema = DATABASE() "
            "  AND k.table_name = :table AND k.column_name = :column "
            "  AND k.referenced_table_name = :locations "
            "  AND k.referenced_column_name = 'id'"
        ),
        {"table": table, "column": column, "locations": _LOCATIONS},
    )
    return [(row[0], row[1]) for row in rows]


def _same_rule(current: str, rule: str) -> bool:
    # InnoDB refuses at once under both RESTRICT and NO ACTION. MariaDB 10.11
    # reported the RESTRICT keys this adds as NO ACTION on a fresh chain run
    # through alembic/env.py (which turns foreign_key_checks off), so a second
    # run must not take one for a key still to be replaced.
    blocking = {"RESTRICT", "NO ACTION"}
    return current == rule or (current in blocking and rule in blocking)


def _set_delete_rule(rule: str) -> None:
    for table, column in _PROTECTED:
        if not _has_table(table):
            continue
        keys = _location_fks(table, column)
        for name, current in keys:
            if not _same_rule(current, rule):
                op.drop_constraint(name, table, type_="foreignkey")
        if not any(_same_rule(current, rule) for _, current in keys):
            op.create_foreign_key(
                f"fk_{table}_{column}_locations",
                table,
                _LOCATIONS,
                [column],
                ["id"],
                ondelete=rule,
            )


def _numbered(base: str, number: int) -> str:
    # Same shape as location_service._numbered; inlined because a migration
    # must keep doing what it did the day it ran.
    suffix = f" ({number})"
    return base[: _NAME_MAX - len(suffix)] + suffix


def _rename_duplicates() -> None:
    bind = op.get_bind()
    # Grouped by the database, so "duplicate" means what the key will mean.
    groups = bind.execute(
        sa.text(
            f"SELECT organization_id, MIN(name), COALESCE(building, '') "
            f"FROM {_LOCATIONS} "
            f"GROUP BY organization_id, name, COALESCE(building, '') "
            f"HAVING COUNT(*) > 1"
        )
    ).fetchall()
    for org_id, name, building_key in groups:
        rows = bind.execute(
            sa.text(
                f"SELECT id, name FROM {_LOCATIONS} "
                "WHERE organization_id = :org AND name = :name "
                "AND COALESCE(building, '') = :bk ORDER BY created_at, id"
            ),
            {"org": org_id, "name": name, "bk": building_key},
        ).fetchall()
        for row_id, own_name in rows[1:]:
            number = 2
            while True:
                candidate = _numbered(own_name, number)
                taken = bind.execute(
                    sa.text(
                        f"SELECT 1 FROM {_LOCATIONS} WHERE organization_id = :org "
                        "AND name = :name AND COALESCE(building, '') = :bk LIMIT 1"
                    ),
                    {"org": org_id, "name": candidate, "bk": building_key},
                ).first()
                if taken is None:
                    break
                number += 1
            bind.execute(
                sa.text(f"UPDATE {_LOCATIONS} SET name = :name WHERE id = :id"),
                {"name": candidate, "id": row_id},
            )


def upgrade() -> None:
    _set_delete_rule("RESTRICT")

    if not _has_table(_LOCATIONS):
        return
    _rename_duplicates()
    if not _has_column(_LOCATIONS, _KEY_COLUMN):
        op.add_column(
            _LOCATIONS,
            sa.Column(
                _KEY_COLUMN,
                sa.String(100),
                sa.Computed("coalesce(building, '')", persisted=True),
            ),
        )
    if not _has_constraint():
        op.create_unique_constraint(
            _CONSTRAINT, _LOCATIONS, ["organization_id", "name", _KEY_COLUMN]
        )


def downgrade() -> None:
    if _has_table(_LOCATIONS):
        if _has_constraint():
            op.drop_constraint(_CONSTRAINT, _LOCATIONS, type_="unique")
        if _has_column(_LOCATIONS, _KEY_COLUMN):
            op.drop_column(_LOCATIONS, _KEY_COLUMN)

    _set_delete_rule("SET NULL")
