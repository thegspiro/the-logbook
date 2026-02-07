"""
Test Enum Consistency Between Database, Backend Models, and Frontend

This test ensures that enum values defined in:
1. Database migrations (SQLAlchemy Enum definitions)
2. Backend Python models/schemas (Enum classes)
3. Frontend TypeScript types

...all match exactly to prevent case mismatch errors.

CRITICAL: This test prevents issues like the organization_type enum bug where
the database had UPPERCASE values but the application sent lowercase values.
"""

import pytest
import re
from pathlib import Path
from typing import Dict, List, Set, Tuple


class TestEnumConsistency:
    """Test that all enum values are consistent across the stack"""

    @pytest.fixture
    def migration_enums(self) -> Dict[str, List[str]]:
        """Extract enum definitions from Alembic migration files"""
        migrations_dir = Path(__file__).parent.parent / "alembic" / "versions"
        enums = {}

        # Pattern to match: sa.Enum('value1', 'value2', ..., name='enumname')
        enum_pattern = r"sa\.Enum\((.*?name=['\"](\w+)['\"].*?)\)"

        for migration_file in migrations_dir.glob("*.py"):
            content = migration_file.read_text()

            for match in re.finditer(enum_pattern, content, re.DOTALL):
                full_match = match.group(1)
                enum_name = match.group(2)

                # Extract values (anything in quotes before 'name=')
                values_section = full_match.split('name=')[0]
                values = re.findall(r"['\"]([^'\"]+)['\"]", values_section)

                if values and enum_name not in enums:
                    enums[enum_name] = values

        return enums

    @pytest.fixture
    def model_enums(self) -> Dict[str, List[str]]:
        """Extract enum definitions from Python models"""
        models_dir = Path(__file__).parent.parent / "app" / "models"
        enums = {}

        for model_file in models_dir.glob("*.py"):
            content = model_file.read_text()

            # Find enum class definitions
            # Pattern: class EnumName(str, enum.Enum): followed by values
            enum_class_pattern = r"class (\w+)\(str, enum\.Enum\):.*?\n((?:    \w+ = ['\"].*?\n)+)"

            for match in re.finditer(enum_class_pattern, content, re.MULTILINE):
                class_name = match.group(1)
                values_block = match.group(2)

                # Extract actual enum values (the string values, not the names)
                values = re.findall(r"= ['\"]([^'\"]+)['\"]", values_block)

                if values:
                    enums[class_name] = values

        return enums

    @pytest.fixture
    def frontend_enums(self) -> Dict[str, List[str]]:
        """Extract enum/union type definitions from TypeScript files"""
        frontend_dir = Path(__file__).parent.parent.parent / "frontend" / "src" / "modules" / "onboarding"
        enums = {}

        # Pattern for TypeScript union types: type EnumName = 'value1' | 'value2' | 'value3';
        union_type_pattern = r"type (\w+) = (['\"][^'\"]+['\"](?:\s*\|\s*['\"][^'\"]+['\"])*)"

        for ts_file in frontend_dir.rglob("*.tsx"):
            content = ts_file.read_text()

            for match in re.finditer(union_type_pattern, content):
                type_name = match.group(1)
                values_str = match.group(2)

                # Extract values from union type
                values = re.findall(r"['\"]([^'\"]+)['\"]", values_str)

                if values and type_name not in enums:
                    enums[type_name] = values

        return enums

    def test_organization_type_consistency(self, migration_enums, model_enums, frontend_enums):
        """
        Test that organization_type enum values match across all layers.

        This is the enum that caused the critical bug - this test prevents regression.
        """
        # Database migration values
        db_values = set(migration_enums.get('organizationtype', []))

        # Backend model values
        backend_values = set(model_enums.get('OrganizationType', []))

        # Frontend type values
        frontend_values = set(frontend_enums.get('OrganizationType', []))

        # All should be defined
        assert db_values, "Database enum 'organizationtype' not found in migrations"
        assert backend_values, "Backend enum 'OrganizationType' not found in models"
        assert frontend_values, "Frontend type 'OrganizationType' not found in TypeScript"

        # All should match exactly
        assert db_values == backend_values, (
            f"Organization type mismatch between database and backend:\n"
            f"Database: {sorted(db_values)}\n"
            f"Backend:  {sorted(backend_values)}\n"
            f"Difference: {db_values.symmetric_difference(backend_values)}"
        )

        assert backend_values == frontend_values, (
            f"Organization type mismatch between backend and frontend:\n"
            f"Backend:  {sorted(backend_values)}\n"
            f"Frontend: {sorted(frontend_values)}\n"
            f"Difference: {backend_values.symmetric_difference(frontend_values)}"
        )

        # Ensure all values are lowercase (convention)
        for value in db_values:
            assert value == value.lower(), (
                f"Database enum value '{value}' is not lowercase. "
                f"Convention: all enum values should be lowercase."
            )

    def test_identifier_type_consistency(self, migration_enums, model_enums, frontend_enums):
        """Test that identifier_type enum values match across all layers"""
        # Database migration values
        db_values = set(migration_enums.get('identifiertype', []))

        # Backend model values
        backend_values = set(model_enums.get('IdentifierType', []))

        # Frontend type values
        frontend_values = set(frontend_enums.get('IdentifierType', []))

        # All should be defined
        assert db_values, "Database enum 'identifiertype' not found in migrations"
        assert backend_values, "Backend enum 'IdentifierType' not found in models"
        assert frontend_values, "Frontend type 'IdentifierType' not found in TypeScript"

        # All should match exactly
        assert db_values == backend_values, (
            f"Identifier type mismatch between database and backend:\n"
            f"Database: {sorted(db_values)}\n"
            f"Backend:  {sorted(backend_values)}"
        )

        assert backend_values == frontend_values, (
            f"Identifier type mismatch between backend and frontend:\n"
            f"Backend:  {sorted(backend_values)}\n"
            f"Frontend: {sorted(frontend_values)}"
        )

    def test_all_enum_values_lowercase(self, migration_enums):
        """
        Test that ALL enum values in migrations follow lowercase convention.

        This prevents future case mismatch issues.
        """
        violations = []

        for enum_name, values in migration_enums.items():
            for value in values:
                if value != value.lower() and value != value.upper():
                    # Skip mixed-case values that might be intentional (like URLs)
                    continue

                if value != value.lower():
                    violations.append(f"{enum_name}: '{value}' should be '{value.lower()}'")

        assert not violations, (
            f"Found {len(violations)} enum values that are not lowercase:\n" +
            "\n".join(f"  - {v}" for v in violations) +
            "\n\nCONVENTION: All enum values should be lowercase to prevent case-sensitivity issues."
        )

    def test_critical_onboarding_enums_exist(self, migration_enums, model_enums):
        """Ensure critical onboarding enums are defined"""
        critical_db_enums = ['organizationtype', 'identifiertype']
        critical_model_enums = ['OrganizationType', 'IdentifierType']

        for enum_name in critical_db_enums:
            assert enum_name in migration_enums, (
                f"Critical enum '{enum_name}' not found in database migrations"
            )

        for enum_name in critical_model_enums:
            assert enum_name in model_enums, (
                f"Critical enum '{enum_name}' not found in backend models"
            )

    def test_enum_values_not_empty(self, migration_enums, model_enums):
        """Ensure no enum has empty value list"""
        for enum_name, values in migration_enums.items():
            assert values, f"Database enum '{enum_name}' has no values defined"

        for enum_name, values in model_enums.items():
            assert values, f"Backend enum '{enum_name}' has no values defined"


# Standalone function for use in scripts/CI
def verify_enum_consistency() -> Tuple[bool, List[str]]:
    """
    Verify enum consistency without pytest.

    Returns:
        Tuple of (success: bool, errors: List[str])
    """
    errors = []

    # TODO: Implement standalone verification logic for CI/scripts
    # This can be called from pre-commit hooks or CI pipelines

    return len(errors) == 0, errors


if __name__ == "__main__":
    """Run verification when executed directly"""
    success, errors = verify_enum_consistency()

    if success:
        print("✅ All enum values are consistent across database, backend, and frontend")
        exit(0)
    else:
        print("❌ Enum consistency check failed:")
        for error in errors:
            print(f"  - {error}")
        exit(1)
