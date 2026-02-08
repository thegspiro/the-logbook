"""
Application Startup Validators

Validation checks that run when the application starts up to catch configuration
and schema issues early in development.

These validators help prevent production issues by catching problems like:
- Enum value mismatches between database and models
- Missing required environment variables
- Database schema inconsistencies
"""

import logging
from typing import List, Tuple
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import OrganizationType, IdentifierType
import enum

logger = logging.getLogger(__name__)


class StartupValidationError(Exception):
    """Raised when a critical startup validation fails"""
    pass


class StartupValidationWarning(Exception):
    """Raised when a non-critical startup validation fails"""
    pass


async def validate_enum_consistency(db: AsyncSession) -> Tuple[bool, List[str]]:
    """
    Validate that database enum values match Python model definitions.

    This prevents the critical bug where database has different case than models
    (e.g., database has UPPERCASE but models expect lowercase).

    Args:
        db: Async database session

    Returns:
        Tuple of (all_valid: bool, warnings: List[str])
    """
    warnings = []

    try:
        from app.core.config import settings

        async def get_enum_values(table: str, column: str) -> List[str]:
            """Query database for enum values"""
            query = text("""
                SELECT COLUMN_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = :schema
                AND TABLE_NAME = :table
                AND COLUMN_NAME = :column
            """)

            result = await db.execute(
                query,
                {
                    'schema': settings.DB_NAME,
                    'table': table,
                    'column': column
                }
            )
            row = result.fetchone()

            if not row:
                return []

            # Parse enum('value1','value2') format
            import re
            column_type = row[0]
            if not column_type.startswith('enum('):
                return []

            values = re.findall(r"'([^']+)'", column_type)
            return values

        async def check_enum(
            enum_class: type[enum.Enum],
            table: str,
            column: str,
            name: str
        ) -> bool:
            """Check single enum for consistency"""
            expected = set(item.value for item in enum_class)
            actual = set(await get_enum_values(table, column))

            if not actual:
                warnings.append(
                    f"{name}: Could not query database enum (table: {table}, column: {column})"
                )
                return False

            if expected != actual:
                warnings.append(
                    f"{name}: Database enum values don't match model! "
                    f"Expected: {sorted(expected)}, Got: {sorted(actual)}"
                )
                return False

            return True

        # Check critical onboarding enums
        org_type_ok = await check_enum(
            OrganizationType,
            'organizations',
            'organization_type',
            'OrganizationType'
        )

        identifier_type_ok = await check_enum(
            IdentifierType,
            'organizations',
            'identifier_type',
            'IdentifierType'
        )

        all_valid = org_type_ok and identifier_type_ok

        if all_valid:
            logger.info("✅ Enum consistency check passed")
        else:
            logger.warning(f"⚠️  Enum consistency check failed with {len(warnings)} warning(s)")

        return all_valid, warnings

    except Exception as e:
        logger.warning(f"Could not validate enum consistency: {e}")
        warnings.append(f"Enum validation error: {str(e)}")
        return False, warnings


async def run_startup_validations(db: AsyncSession, strict: bool = False) -> None:
    """
    Run all startup validation checks.

    Args:
        db: Async database session
        strict: If True, raise exception on any validation failure.
                If False, only log warnings.

    Raises:
        StartupValidationError: If strict=True and validation fails
    """
    logger.info("Running startup validation checks...")

    all_valid = True
    all_warnings = []

    # Enum consistency check
    enum_valid, enum_warnings = await validate_enum_consistency(db)
    all_valid = all_valid and enum_valid
    all_warnings.extend(enum_warnings)

    # Log results
    if all_valid:
        logger.info("✅ All startup validation checks passed")
    else:
        logger.warning(f"⚠️  {len(all_warnings)} startup validation warning(s):")
        for warning in all_warnings:
            logger.warning(f"   - {warning}")

        if strict:
            raise StartupValidationError(
                f"Startup validation failed with {len(all_warnings)} error(s). "
                "See logs for details."
            )
        else:
            logger.warning(
                "Startup validation warnings detected but continuing (strict mode disabled). "
                "Fix these issues to ensure correct application behavior."
            )


async def validate_enum_case_convention(db: AsyncSession) -> Tuple[bool, List[str]]:
    """
    Validate that all enum values follow lowercase convention.

    Returns:
        Tuple of (all_lowercase: bool, violations: List[str])
    """
    violations = []

    try:
        from app.core.config import settings

        # Get all enum columns from database
        query = text("""
            SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = :schema
            AND DATA_TYPE = 'enum'
        """)

        result = await db.execute(query, {'schema': settings.DB_NAME})
        results = result.fetchall()

        import re
        for table, column, column_type in results:
            # Parse enum values
            values = re.findall(r"'([^']+)'", column_type)

            for value in values:
                # Check if value is all lowercase
                if value != value.lower():
                    violations.append(
                        f"{table}.{column} has non-lowercase value: '{value}' "
                        f"(should be '{value.lower()}')"
                    )

        return len(violations) == 0, violations

    except Exception as e:
        logger.warning(f"Could not validate enum case convention: {e}")
        return False, [f"Validation error: {str(e)}"]
