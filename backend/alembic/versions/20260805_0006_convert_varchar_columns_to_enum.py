"""Convert 22 VARCHAR columns to the ENUM their models declare

These columns are declared as ``Enum`` in ``app/models/`` but were created as
``sa.String`` by their migrations. A fresh install built by ``create_all()``
gets a real ``ENUM``; a database built from this chain keeps a permissive
``VARCHAR`` that accepts any string the application happens to write.

``store_orders.payment_method`` is the odd one out — already an ENUM on both
sides, but with ``cash_app`` and ``zelle`` appended at the end rather than in
the models' order. MySQL stores an ENUM as an ordinal, so the same ordinal
means a different value depending on which path built the database. Nothing
reads these ordinals today, but a dump/restore or a raw ordinal comparison
across the two shapes would silently mismatch. Reordering converts by value,
so stored rows keep their meaning.

**Out-of-range data aborts this revision before anything changes.** Narrowing a
VARCHAR to an ENUM discards any value not in the new set — MySQL raises error
1265 under strict ``sql_mode`` and, with strict mode off, would replace the
value with ``''``. Rather than depend on the server's mode, every column is
checked up front and the migration raises with the offending table, column and
values listed, so the data can be corrected and the migration re-run. No
partial conversion is possible: the check completes before the first ALTER.

Revision ID: 20260805_0006
Revises: 20260805_0005
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260805_0006"
down_revision = "20260805_0005"
branch_labels = None
depends_on = None


# (table, column, values, nullable)
# Values are in the order the corresponding Python enum declares them, so the
# resulting ENUM ordinals match a create_all-built database exactly.
_ENUM_COLUMNS = [
    ("equipment_requests", "priority", ["low", "normal", "high"], False),
    (
        "equipment_requests",
        "request_type",
        ["checkout", "issuance", "purchase", "return"],
        False,
    ),
    (
        "equipment_requests",
        "status",
        ["pending", "approved", "denied", "fulfilled"],
        False,
    ),
    (
        "external_training_providers",
        "provider_type",
        [
            "vector_solutions",
            "target_solutions",
            "lexipol",
            "i_am_responding",
            "custom_api",
        ],
        False,
    ),
    (
        "external_training_sync_logs",
        "status",
        ["pending", "in_progress", "completed", "failed", "partial"],
        True,
    ),
    (
        "facility_access_keys",
        "key_type",
        [
            "physical_key",
            "fob",
            "access_code",
            "key_card",
            "biometric",
            "combination",
            "other",
        ],
        False,
    ),
    (
        "facility_capital_projects",
        "project_status",
        [
            "planning",
            "approved",
            "bidding",
            "in_progress",
            "on_hold",
            "completed",
            "cancelled",
        ],
        False,
    ),
    (
        "facility_capital_projects",
        "project_type",
        [
            "renovation",
            "new_construction",
            "repair",
            "upgrade",
            "expansion",
            "demolition",
            "environmental",
            "ada_compliance",
            "other",
        ],
        False,
    ),
    (
        "facility_compliance_checklists",
        "compliance_type",
        [
            "ada",
            "fire_code",
            "building_code",
            "health",
            "environmental",
            "osha",
            "nfpa",
            "other",
        ],
        False,
    ),
    (
        "facility_emergency_contacts",
        "contact_type",
        [
            "utility_provider",
            "alarm_company",
            "elevator_service",
            "plumber",
            "electrician",
            "hvac_service",
            "locksmith",
            "general_contractor",
            "fire_protection",
            "pest_control",
            "roofing",
            "janitorial",
            "other",
        ],
        False,
    ),
    (
        "facility_inspections",
        "inspection_type",
        [
            "fire",
            "building_code",
            "health",
            "ada",
            "environmental",
            "insurance",
            "routine",
            "other",
        ],
        False,
    ),
    (
        "facility_insurance_policies",
        "policy_type",
        [
            "property",
            "liability",
            "flood",
            "earthquake",
            "workers_comp",
            "umbrella",
            "equipment",
            "other",
        ],
        False,
    ),
    (
        "facility_maintenance_types",
        "category",
        [
            "preventive",
            "repair",
            "inspection",
            "renovation",
            "cleaning",
            "safety",
            "other",
        ],
        True,
    ),
    (
        "facility_maintenance_types",
        "default_interval_unit",
        ["days", "weeks", "months", "years"],
        True,
    ),
    (
        "facility_rooms",
        "room_type",
        [
            "apparatus_bay",
            "bunk_room",
            "kitchen",
            "bathroom",
            "office",
            "training_room",
            "storage",
            "mechanical",
            "lobby",
            "common_area",
            "laundry",
            "gym",
            "decontamination",
            "dispatch",
            "other",
        ],
        False,
    ),
    (
        "facility_shutoff_locations",
        "shutoff_type",
        [
            "water_main",
            "gas_main",
            "electrical_main",
            "fire_suppression",
            "hvac",
            "irrigation",
            "other",
        ],
        False,
    ),
    (
        "facility_systems",
        "condition",
        ["excellent", "good", "fair", "poor", "critical"],
        False,
    ),
    (
        "facility_types",
        "category",
        [
            "station",
            "training",
            "administration",
            "storage",
            "meeting_hall",
            "community",
            "other",
        ],
        True,
    ),
    (
        "facility_utility_accounts",
        "billing_cycle",
        ["monthly", "quarterly", "annual", "other"],
        True,
    ),
    (
        "facility_utility_accounts",
        "utility_type",
        ["electric", "gas", "water", "sewer", "internet", "phone", "trash", "other"],
        False,
    ),
    ("shift_patterns", "pattern_type", ["daily", "weekly", "platoon", "custom"], False),
    (
        "store_orders",
        "payment_method",
        [
            "venmo",
            "paypal",
            "cash_app",
            "zelle",
            "cash",
            "check",
            "payroll_deduction",
            "other",
        ],
        True,
    ),
    (
        "training_requirements",
        "due_date_type",
        ["calendar_period", "rolling", "certification_period", "fixed_date"],
        True,
    ),
]


def _pending(inspector):
    """Columns that exist and still need converting, with their target spec."""
    pending = []
    for table, column, values, nullable in _ENUM_COLUMNS:
        if not inspector.has_table(table):
            continue
        columns = {c["name"]: c for c in inspector.get_columns(table)}
        if column not in columns:
            continue
        current = columns[column]["type"]
        # Already the exact target ENUM (create_all-built database).
        if list(getattr(current, "enums", [])) == values:
            continue
        pending.append((table, column, values, nullable))
    return pending


def _assert_convertible(bind, pending) -> None:
    """Fail before any ALTER if a column holds a value the ENUM cannot store."""
    problems = []
    for table, column, values, _nullable in pending:
        placeholders = ", ".join(f":v{i}" for i in range(len(values)))
        params = {f"v{i}": v for i, v in enumerate(values)}
        rows = bind.execute(
            sa.text(
                f"SELECT DISTINCT `{column}` AS value, COUNT(*) AS n "
                f"FROM `{table}` "
                f"WHERE `{column}` IS NOT NULL "
                f"  AND `{column}` NOT IN ({placeholders}) "
                f"GROUP BY `{column}` LIMIT 10"
            ),
            params,
        ).fetchall()
        if rows:
            found = ", ".join(f"{r.value!r} ({r.n} row(s))" for r in rows)
            problems.append(f"  {table}.{column}: {found}")

    if problems:
        raise RuntimeError(
            "Cannot convert these columns to ENUM — they hold values outside "
            "the model's enum:\n"
            + "\n".join(problems)
            + "\n\nCorrect or clear these values, then re-run the migration. "
            "Nothing has been changed."
        )


def upgrade() -> None:
    bind = op.get_bind()
    pending = _pending(sa.inspect(bind))

    _assert_convertible(bind, pending)

    for table, column, values, nullable in pending:
        op.alter_column(
            table,
            column,
            existing_type=sa.String(50),
            type_=sa.Enum(*values, name=f"{table}_{column}"),
            existing_nullable=nullable,
            nullable=nullable,
        )


def downgrade() -> None:
    # Widening back to VARCHAR loses nothing, but the column length the
    # original migrations used varied per column and is not worth restoring
    # exactly. Left as a no-op.
    pass
