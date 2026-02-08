#!/usr/bin/env python3
"""
Verify all database ENUM types match the expected lowercase values.

This script checks that all MySQL ENUM columns in the database have the correct
lowercase values matching what the application code sends.

Usage:
    python scripts/verify_all_enums.py
"""
import sys
from sqlalchemy import create_engine, text, inspect
from app.core.config import settings


def verify_enum_values():
    """Verify all enum columns have correct lowercase values"""

    # Expected enum definitions (table, column, expected_values)
    expected_enums = [
        ("users", "status", ["active", "inactive", "suspended", "probationary", "retired"]),
        ("organizations", "organization_type", ["fire_department", "ems_only", "fire_ems_combined"]),
        ("organizations", "identifier_type", ["fdid", "state_id", "department_id"]),
        ("audit_logs", "severity", ["info", "warning", "critical"]),
        ("training_courses", "training_type", ["certification", "continuing_education", "skills_practice", "orientation", "refresher", "specialty"]),
        ("training_records", "status", ["scheduled", "in_progress", "completed", "cancelled", "failed"]),
        ("elections", "status", ["draft", "open", "closed", "cancelled"]),
        ("events", "event_type", ["business_meeting", "public_education", "training", "social", "fundraiser", "ceremony", "other"]),
        ("event_rsvps", "status", ["going", "not_going", "maybe"]),
        ("inventory_items", "item_type", ["uniform", "ppe", "tool", "equipment", "vehicle", "electronics", "consumable", "other"]),
        ("inventory_items", "condition", ["excellent", "good", "fair", "poor", "damaged", "out_of_service", "retired"]),
        ("inventory_items", "status", ["available", "assigned", "checked_out", "in_maintenance", "lost", "stolen", "retired"]),
    ]

    engine = create_engine(settings.SYNC_DATABASE_URL)

    print("Verifying database ENUM values...")
    print("=" * 80)

    all_passed = True

    with engine.connect() as conn:
        for table_name, column_name, expected_values in expected_enums:
            # Check if table exists
            inspector = inspect(engine)
            if table_name not in inspector.get_table_names():
                print(f"⚠️  Table '{table_name}' does not exist yet")
                continue

            # Get column definition
            result = conn.execute(text(f"""
                SELECT COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '{table_name}'
                AND COLUMN_NAME = '{column_name}'
            """))

            row = result.fetchone()
            if not row:
                print(f"⚠️  Column '{table_name}.{column_name}' does not exist")
                continue

            column_type = row[0]

            # Parse ENUM values from column type
            # Format: enum('value1','value2','value3')
            if not column_type.startswith("enum("):
                print(f"⚠️  Column '{table_name}.{column_name}' is not an ENUM type: {column_type}")
                continue

            # Extract values
            values_str = column_type[5:-1]  # Remove "enum(" and ")"
            actual_values = [v.strip("'") for v in values_str.split(",")]

            # Compare
            if set(actual_values) == set(expected_values):
                print(f"✅ {table_name}.{column_name}: {actual_values}")
            else:
                print(f"❌ {table_name}.{column_name}")
                print(f"   Expected: {expected_values}")
                print(f"   Actual:   {actual_values}")
                all_passed = False

    print("=" * 80)

    if all_passed:
        print("✅ All ENUM values are correct!")
        return 0
    else:
        print("❌ Some ENUM values are incorrect. Please rebuild the database with 'docker compose down -v && docker compose up --build'")
        return 1


if __name__ == "__main__":
    sys.exit(verify_enum_values())
