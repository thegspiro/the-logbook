#!/usr/bin/env python3
"""
Database Enum Verification Script

Verifies that enum values in the actual database match the expected values
defined in Python models.

This script:
1. Connects to the database
2. Queries actual enum values from MySQL
3. Compares them with model definitions
4. Reports any mismatches

Usage:
    python scripts/verify_database_enums.py

Exit codes:
    0 - All enums match
    1 - Mismatch found
    2 - Connection error
"""

import sys
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.models.user import OrganizationType, IdentifierType
import enum


class EnumVerifier:
    """Verify database enum values against model definitions"""

    def __init__(self):
        """Initialize database connection"""
        try:
            self.engine = create_engine(settings.DATABASE_URL)
            Session = sessionmaker(bind=self.engine)
            self.session = Session()
        except Exception as e:
            print(f"❌ Failed to connect to database: {e}")
            sys.exit(2)

    def get_mysql_enum_values(self, table_name: str, column_name: str) -> list:
        """
        Get enum values from MySQL database.

        Args:
            table_name: Name of the table
            column_name: Name of the enum column

        Returns:
            List of enum values as strings
        """
        query = text("""
            SELECT COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = :schema
            AND TABLE_NAME = :table
            AND COLUMN_NAME = :column
        """)

        result = self.session.execute(
            query,
            {
                'schema': settings.MYSQL_DATABASE,
                'table': table_name,
                'column': column_name
            }
        ).fetchone()

        if not result:
            return []

        # Parse enum('value1','value2','value3') format
        column_type = result[0]
        if not column_type.startswith('enum('):
            return []

        # Extract values between quotes
        import re
        values = re.findall(r"'([^']+)'", column_type)
        return values

    def verify_enum(
        self,
        enum_class: type[enum.Enum],
        table_name: str,
        column_name: str,
        display_name: str
    ) -> bool:
        """
        Verify a single enum against database.

        Args:
            enum_class: Python enum class to verify
            table_name: Database table name
            column_name: Database column name
            display_name: Human-readable name for reporting

        Returns:
            True if enum matches, False otherwise
        """
        # Get expected values from Python enum
        expected_values = set(item.value for item in enum_class)

        # Get actual values from database
        actual_values = set(self.get_mysql_enum_values(table_name, column_name))

        if not actual_values:
            print(f"⚠️  {display_name}: No enum found in database (table: {table_name}, column: {column_name})")
            return False

        # Compare
        if expected_values == actual_values:
            print(f"✅ {display_name}: Database matches model")
            return True
        else:
            print(f"❌ {display_name}: MISMATCH DETECTED")
            print(f"   Expected (from model): {sorted(expected_values)}")
            print(f"   Actual (from database): {sorted(actual_values)}")

            missing_in_db = expected_values - actual_values
            extra_in_db = actual_values - expected_values

            if missing_in_db:
                print(f"   Missing in database: {sorted(missing_in_db)}")
            if extra_in_db:
                print(f"   Extra in database: {sorted(extra_in_db)}")

            return False

    def verify_all_critical_enums(self) -> bool:
        """
        Verify all critical enums used in onboarding.

        Returns:
            True if all match, False if any mismatch
        """
        print("=" * 70)
        print("DATABASE ENUM VERIFICATION")
        print("=" * 70)
        print()

        results = []

        # Organization Type
        results.append(
            self.verify_enum(
                OrganizationType,
                'organizations',
                'organization_type',
                'OrganizationType (organizations.organization_type)'
            )
        )

        print()

        # Identifier Type
        results.append(
            self.verify_enum(
                IdentifierType,
                'organizations',
                'identifier_type',
                'IdentifierType (organizations.identifier_type)'
            )
        )

        print()
        print("=" * 70)

        all_passed = all(results)

        if all_passed:
            print("✅ ALL ENUMS VERIFIED - Database matches models")
        else:
            print("❌ VERIFICATION FAILED - Mismatches detected")
            print()
            print("RECOMMENDED ACTIONS:")
            print("1. Check if a migration needs to be run: alembic upgrade head")
            print("2. If migration is current, create a new migration to fix enum values")
            print("3. Review migration files for case mismatches")

        print("=" * 70)
        return all_passed

    def close(self):
        """Close database connection"""
        self.session.close()


def main():
    """Main entry point"""
    verifier = EnumVerifier()

    try:
        all_passed = verifier.verify_all_critical_enums()
        verifier.close()

        # Exit with appropriate code
        sys.exit(0 if all_passed else 1)

    except Exception as e:
        print(f"❌ Verification failed with error: {e}")
        import traceback
        traceback.print_exc()
        verifier.close()
        sys.exit(2)


if __name__ == "__main__":
    main()
