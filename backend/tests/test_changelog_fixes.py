"""
Tests for issues identified in the 2026-02-15 changelog entries.

These tests verify fixes for:
1. Duplicate index definitions crashing Base.metadata.create_all() on MySQL
2. NameError: get_current_user must be defined before PermissionChecker classes
3. Documents service returning objects directly (not tuples)
4. Public portal using real database queries (not placeholder data)
5. Fast-path init log accuracy (dropped table count excludes alembic_version)
6. toAppError() check ordering (Axios errors before Error instances)

Run with:
    pytest tests/test_changelog_fixes.py -v
"""

import inspect
import ast
import os
import pytest
from collections import defaultdict

from sqlalchemy import Index as SAIndex, inspect as sa_inspect
from sqlalchemy.orm import RelationshipProperty

# ---------------------------------------------------------------------------
# Import all models to register them with Base.metadata
# ---------------------------------------------------------------------------
from app.models import *  # noqa: F401,F403
from app.core.database import Base

_metadata = Base.metadata
_tables = _metadata.tables

# Build model class map
_model_classes: dict[str, type] = {}
for _mapper in Base.registry.mappers:
    cls = _mapper.class_
    if hasattr(cls, "__tablename__"):
        _model_classes[cls.__tablename__] = cls


# ===========================================================================
# 1. Duplicate Index Definitions (Crash on create_all)
# ===========================================================================


class TestNoDuplicateIndexes:
    """
    Verify that no model column has both `index=True` AND an explicit
    Index() in __table_args__ with the same single-column set and
    the SAME NAME.  This exact pattern crashed Base.metadata.create_all()
    on MySQL with "Duplicate key name" errors.

    Regression tests for:
    - Location.organization_id  (ix_locations_organization_id)
    - VotingToken.token         (ix_voting_tokens_token)
    """

    def _get_column_level_indexes(self, table):
        """
        Return column names that have index=True on the Column definition.
        SQLAlchemy auto-generates an Index for these.
        """
        indexed_cols = set()
        for col in table.columns:
            if col.index is True:
                indexed_cols.add(col.name)
        return indexed_cols

    def _get_explicit_table_args_indexes(self, table_name):
        """
        Return a dict of {frozenset(col_names): index_name} for Index()
        entries explicitly defined in the model's __table_args__.

        This parses the model class directly (not table.indexes) to
        distinguish explicit indexes from auto-generated ones.
        """
        model_cls = _model_classes.get(table_name)
        if model_cls is None:
            return {}

        table_args = getattr(model_cls, "__table_args__", None)
        if table_args is None:
            return {}

        # __table_args__ can be a tuple of Index/Constraint objects,
        # or a tuple ending with a dict of table kwargs
        explicit = {}
        items = table_args if isinstance(table_args, (list, tuple)) else [table_args]
        for item in items:
            if isinstance(item, SAIndex):
                col_names = []
                for expr in item.expressions:
                    if hasattr(expr, "name"):
                        col_names.append(expr.name)
                    elif hasattr(expr, "key"):
                        col_names.append(expr.key)
                    elif isinstance(expr, str):
                        col_names.append(expr)
                if col_names:
                    explicit[frozenset(col_names)] = item.name
        return explicit

    def test_no_same_name_duplicate_indexes(self):
        """
        The critical bug: a column with index=True auto-generates an index
        named (by the naming convention) ix_<table>_<column>.  If __table_args__
        also defines an Index("ix_<table>_<column>", "<column>"), MySQL raises
        'Duplicate key name' on create_all().

        This test catches that exact scenario.
        """
        duplicates = []

        for table_name, table in _tables.items():
            col_level = self._get_column_level_indexes(table)
            explicit = self._get_explicit_table_args_indexes(table_name)

            for col_name in col_level:
                key = frozenset([col_name])
                if key in explicit:
                    # Check if the auto-generated name matches the explicit name
                    auto_name = f"ix_{table_name}_{col_name}"
                    explicit_name = explicit[key]
                    if auto_name == explicit_name:
                        duplicates.append(
                            f"{table_name}.{col_name}: column has index=True "
                            f"(auto-generates '{auto_name}') AND explicit "
                            f"Index('{explicit_name}', ...) — will crash "
                            f"create_all() on MySQL with 'Duplicate key name'"
                        )

        assert not duplicates, (
            f"Duplicate index definitions found that will crash MySQL:\n"
            + "\n".join(duplicates)
        )

    def test_location_organization_id_no_duplicate(self):
        """
        Regression: Location.organization_id had both index=True and
        Index("ix_locations_organization_id", "organization_id").
        """
        table = _tables.get("locations")
        assert table is not None, "locations table not found"

        org_col = table.columns.get("organization_id")
        assert org_col is not None

        # The column should NOT have index=True if there's an explicit index
        # with the same naming-convention name
        if org_col.index is True:
            for idx in table.indexes:
                idx_cols = [c.name for c in idx.columns]
                if idx_cols == ["organization_id"] and idx.name == "ix_locations_organization_id":
                    pytest.fail(
                        "Location.organization_id has both index=True AND "
                        "explicit Index('ix_locations_organization_id') — "
                        "this crashes MySQL create_all()"
                    )

    def test_voting_token_no_duplicate(self):
        """
        Regression: VotingToken.token had both index=True and
        Index("ix_voting_tokens_token", "token").
        """
        table = _tables.get("voting_tokens")
        assert table is not None, "voting_tokens table not found"

        token_col = table.columns.get("token")
        assert token_col is not None

        if token_col.index is True:
            for idx in table.indexes:
                idx_cols = [c.name for c in idx.columns]
                if idx_cols == ["token"] and idx.name == "ix_voting_tokens_token":
                    pytest.fail(
                        "VotingToken.token has both index=True AND "
                        "explicit Index('ix_voting_tokens_token') — "
                        "this crashes MySQL create_all()"
                    )

    def test_all_models_metadata_create_all_compatible(self):
        """
        Verify that no two indexes across any table share the same name.
        MySQL requires unique index names within a table,
        and duplicate names crash create_all().

        Note: We check only the table.indexes collection which already
        includes auto-generated indexes from index=True columns.
        We do NOT double-count them.
        """
        for table_name, table in _tables.items():
            seen_names: dict[str, int] = defaultdict(int)
            for idx in table.indexes:
                seen_names[idx.name] += 1

            duplicates = {
                name: count
                for name, count in seen_names.items()
                if count > 1
            }
            assert not duplicates, (
                f"Table '{table_name}' has duplicate index names "
                f"(will crash MySQL create_all()):\n"
                + "\n".join(f"  {name}: appears {count} times" for name, count in duplicates.items())
            )


# ===========================================================================
# 2. NameError: get_current_user must precede PermissionChecker
# ===========================================================================


class TestDependencyOrdering:
    """
    Verify that get_current_user is defined BEFORE PermissionChecker
    and AllPermissionChecker in the dependencies module.

    Regression: PermissionChecker classes used Depends(get_current_user)
    but get_current_user was defined after them, causing NameError at
    import time.
    """

    def test_get_current_user_defined_before_permission_checker(self):
        """get_current_user must be defined before PermissionChecker."""
        from app.api import dependencies

        source = inspect.getsource(dependencies)
        tree = ast.parse(source)

        # Find line numbers of key definitions
        get_current_user_line = None
        permission_checker_line = None
        all_permission_checker_line = None

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name == "get_current_user":
                    get_current_user_line = node.lineno
            elif isinstance(node, ast.ClassDef):
                if node.name == "PermissionChecker":
                    permission_checker_line = node.lineno
                elif node.name == "AllPermissionChecker":
                    all_permission_checker_line = node.lineno

        assert get_current_user_line is not None, (
            "get_current_user not found in dependencies module"
        )
        assert permission_checker_line is not None, (
            "PermissionChecker not found in dependencies module"
        )

        assert get_current_user_line < permission_checker_line, (
            f"get_current_user (line {get_current_user_line}) must be defined "
            f"BEFORE PermissionChecker (line {permission_checker_line}) to avoid "
            f"NameError at import time"
        )

        if all_permission_checker_line is not None:
            assert get_current_user_line < all_permission_checker_line, (
                f"get_current_user (line {get_current_user_line}) must be defined "
                f"BEFORE AllPermissionChecker (line {all_permission_checker_line})"
            )

    def test_permission_checker_can_be_imported(self):
        """PermissionChecker should import without NameError."""
        from app.api.dependencies import PermissionChecker
        assert PermissionChecker is not None

    def test_all_permission_checker_can_be_imported(self):
        """AllPermissionChecker should import without NameError."""
        from app.api.dependencies import AllPermissionChecker
        assert AllPermissionChecker is not None

    def test_require_permission_returns_permission_checker(self):
        """require_permission factory returns a PermissionChecker instance."""
        from app.api.dependencies import require_permission, PermissionChecker
        checker = require_permission("admin.access")
        assert isinstance(checker, PermissionChecker)

    def test_permission_checker_stores_permissions(self):
        """PermissionChecker should store the required permissions list."""
        from app.api.dependencies import PermissionChecker
        checker = PermissionChecker(["foo.bar", "baz.qux"])
        assert checker.required_permissions == ["foo.bar", "baz.qux"]


# ===========================================================================
# 3. Documents Service API Consistency
# ===========================================================================


class TestDocumentsServiceAPI:
    """
    Verify the documents service returns objects directly (or raises
    HTTPException) instead of returning (result, error) tuples.

    Regression: The service previously had an inconsistent pattern where
    some methods returned tuples and others returned objects. This was
    consolidated so all methods return objects directly or raise exceptions.
    """

    def test_service_methods_do_not_return_tuples(self):
        """
        Inspect document_service.py source to ensure no method returns
        a tuple. Methods should either return a value or raise an exception.
        """
        try:
            from app.services import document_service
        except ImportError:
            pytest.skip("document_service not found")

        source = inspect.getsource(document_service)
        tree = ast.parse(source)

        tuple_returns = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_name = node.name
                for child in ast.walk(node):
                    if isinstance(child, ast.Return) and child.value:
                        # Check if return value is a tuple
                        if isinstance(child.value, ast.Tuple):
                            tuple_returns.append(
                                f"{func_name} (line {child.lineno}): "
                                f"returns a tuple"
                            )

        assert not tuple_returns, (
            f"Document service methods returning tuples "
            f"(should return objects or raise exceptions):\n"
            + "\n".join(tuple_returns)
        )


# ===========================================================================
# 4. Public Portal Real Database Queries
# ===========================================================================


class TestPublicPortalImplementation:
    """
    Verify the public portal endpoints use real database queries
    instead of returning placeholder/hardcoded data.

    Regression: The stats and events endpoints previously returned
    hardcoded values like {"active_members": 0, "apparatus_count": 0}.
    """

    def test_portal_stats_uses_real_queries(self):
        """
        The organization stats endpoint should query the User and
        Apparatus tables, not return hardcoded zeros.
        """
        portal_path = os.path.join(
            os.path.dirname(__file__), "..", "app", "api", "public", "portal.py"
        )
        if not os.path.exists(portal_path):
            pytest.skip("portal.py not found")

        with open(portal_path) as f:
            source = f.read()

        # Should reference User model for member count
        assert "User" in source, (
            "Public portal should query the User model for member count"
        )

        # Should reference Apparatus model for apparatus count
        assert "Apparatus" in source, (
            "Public portal should query the Apparatus model for apparatus count"
        )

        # Should NOT have hardcoded return values
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Return) and node.value:
                if isinstance(node.value, ast.Dict):
                    for key, value in zip(node.value.keys, node.value.values):
                        if (
                            isinstance(key, ast.Constant)
                            and isinstance(value, ast.Constant)
                            and key.value in ("active_members", "apparatus_count")
                            and value.value == 0
                        ):
                            pytest.fail(
                                f"Public portal returns hardcoded "
                                f"'{key.value}': {value.value} instead of "
                                f"querying the database"
                            )

    def test_portal_events_queries_database(self):
        """
        The public events endpoint should query Event model with
        filters for public education events and future dates.
        """
        portal_path = os.path.join(
            os.path.dirname(__file__), "..", "app", "api", "public", "portal.py"
        )
        if not os.path.exists(portal_path):
            pytest.skip("portal.py not found")

        with open(portal_path) as f:
            source = f.read()

        # Should reference Event model
        assert "Event" in source, (
            "Public portal should query the Event model for public events"
        )

        # Should filter by event type (PUBLIC_EDUCATION or similar)
        has_event_type_filter = (
            "PUBLIC_EDUCATION" in source
            or "public_education" in source
            or "EventType" in source
        )
        assert has_event_type_filter, (
            "Public portal should filter events by type (e.g., PUBLIC_EDUCATION)"
        )

    def test_portal_has_whitelist_filtering(self):
        """
        The portal should filter response data through the whitelist
        system for data access control.
        """
        portal_path = os.path.join(
            os.path.dirname(__file__), "..", "app", "api", "public", "portal.py"
        )
        if not os.path.exists(portal_path):
            pytest.skip("portal.py not found")

        with open(portal_path) as f:
            source = f.read()

        has_whitelist = (
            "whitelist" in source.lower()
            or "check_field_whitelisted" in source
            or "filter_data_by_whitelist" in source
        )
        assert has_whitelist, (
            "Public portal should use whitelist-based data filtering"
        )


# ===========================================================================
# 5. Fast-Path Init Log Accuracy
# ===========================================================================


class TestFastPathInit:
    """
    Verify the fast-path database initialization logic.

    Regression: The dropped table count incorrectly included the
    alembic_version table, which was actually skipped.
    """

    def test_fast_path_skips_alembic_version(self):
        """
        _fast_path_init() should skip the alembic_version table when
        dropping existing tables and the count should reflect that.
        """
        main_path = os.path.join(
            os.path.dirname(__file__), "..", "main.py"
        )
        if not os.path.exists(main_path):
            pytest.skip("main.py not found")

        with open(main_path) as f:
            source = f.read()

        # Verify the function exists
        assert "_fast_path_init" in source, "_fast_path_init not found in main.py"

        # Verify alembic_version is explicitly skipped
        assert 'alembic_version' in source, (
            "_fast_path_init should reference alembic_version to skip it"
        )

        # Look for the skip pattern: continue when table is alembic_version
        has_skip = (
            'table_name == "alembic_version"' in source
            or "table_name == 'alembic_version'" in source
        )
        assert has_skip, (
            "_fast_path_init should skip alembic_version table during drop"
        )

    def test_fast_path_calls_create_all(self):
        """Fast-path should use Base.metadata.create_all() for speed."""
        main_path = os.path.join(
            os.path.dirname(__file__), "..", "main.py"
        )
        if not os.path.exists(main_path):
            pytest.skip("main.py not found")

        with open(main_path) as f:
            source = f.read()

        assert "create_all" in source, (
            "_fast_path_init should call Base.metadata.create_all() "
            "for fast schema creation"
        )

    def test_fast_path_stamps_alembic_head(self):
        """
        After create_all(), fast-path must stamp alembic to 'head'
        so future startups don't re-run migrations.
        """
        main_path = os.path.join(
            os.path.dirname(__file__), "..", "main.py"
        )
        if not os.path.exists(main_path):
            pytest.skip("main.py not found")

        with open(main_path) as f:
            source = f.read()

        assert 'stamp' in source and 'head' in source, (
            "_fast_path_init should stamp alembic to 'head' after create_all()"
        )


# ===========================================================================
# 6. Error Handling Utility Ordering (Frontend - tested via source analysis)
# ===========================================================================


class TestFrontendErrorHandling:
    """
    Verify the frontend error handling utility has correct check ordering.

    Regression: toAppError() previously checked `error instanceof Error`
    before checking for Axios-like errors with `.response`. Since Axios
    errors extend Error, this caused HTTP status codes and API detail
    messages to be lost.

    The correct order is:
    1. Check for Axios/HTTP errors (has .response property)
    2. Check for standard Error instances
    3. Check for plain AppError objects
    4. Check for string errors
    5. Fallback for unknown types
    """

    ERROR_HANDLING_PATH = os.path.join(
        os.path.dirname(__file__), "..", "..", "frontend", "src", "utils", "errorHandling.ts"
    )

    def test_error_handling_file_exists(self):
        """The error handling utility file must exist."""
        assert os.path.exists(self.ERROR_HANDLING_PATH), (
            "frontend/src/utils/errorHandling.ts not found"
        )

    def test_toAppError_checks_response_before_instanceof(self):
        """
        In toAppError(), the Axios/HTTP error check (looking for .response)
        must come BEFORE the `instanceof Error` check.

        If the order is reversed, Axios errors (which extend Error) would
        be caught by the Error branch, losing the HTTP status code and
        API detail message.
        """
        if not os.path.exists(self.ERROR_HANDLING_PATH):
            pytest.skip("errorHandling.ts not found")

        with open(self.ERROR_HANDLING_PATH) as f:
            source = f.read()

        # Find the position of each check within toAppError
        response_check_pos = source.find("'response' in error")
        if response_check_pos == -1:
            response_check_pos = source.find('"response" in error')

        instanceof_check_pos = source.find("instanceof Error")

        assert response_check_pos != -1, (
            "toAppError() should check for 'response' property (Axios errors)"
        )
        assert instanceof_check_pos != -1, (
            "toAppError() should check for instanceof Error"
        )
        assert response_check_pos < instanceof_check_pos, (
            f"toAppError() checks 'instanceof Error' (pos {instanceof_check_pos}) "
            f"BEFORE 'response' in error (pos {response_check_pos}). "
            f"This causes Axios errors to lose HTTP status codes. "
            f"The .response check must come first."
        )

    def test_toAppError_extracts_status(self):
        """toAppError() should extract HTTP status from Axios-like errors."""
        if not os.path.exists(self.ERROR_HANDLING_PATH):
            pytest.skip("errorHandling.ts not found")

        with open(self.ERROR_HANDLING_PATH) as f:
            source = f.read()

        assert "status" in source, (
            "toAppError() should extract HTTP status from error responses"
        )

    def test_toAppError_extracts_detail_message(self):
        """toAppError() should extract API detail message from response data."""
        if not os.path.exists(self.ERROR_HANDLING_PATH):
            pytest.skip("errorHandling.ts not found")

        with open(self.ERROR_HANDLING_PATH) as f:
            source = f.read()

        # FastAPI returns errors as {"detail": "message"}
        assert "detail" in source, (
            "toAppError() should extract 'detail' field from API error responses "
            "(FastAPI error format)"
        )

    def test_getErrorMessage_uses_fallback(self):
        """getErrorMessage() should accept and use a fallback message."""
        if not os.path.exists(self.ERROR_HANDLING_PATH):
            pytest.skip("errorHandling.ts not found")

        with open(self.ERROR_HANDLING_PATH) as f:
            source = f.read()

        assert "fallback" in source, (
            "getErrorMessage() should accept a fallback parameter"
        )

    def test_error_handling_exports_required_functions(self):
        """The module must export toAppError, getErrorMessage, and isAppError."""
        if not os.path.exists(self.ERROR_HANDLING_PATH):
            pytest.skip("errorHandling.ts not found")

        with open(self.ERROR_HANDLING_PATH) as f:
            source = f.read()

        for fn_name in ["toAppError", "getErrorMessage", "isAppError"]:
            assert f"export function {fn_name}" in source, (
                f"errorHandling.ts must export '{fn_name}'"
            )

    def test_no_catch_err_any_pattern(self):
        """
        Frontend files should not use `catch (err: any)`.
        They should use `catch (err: unknown)` with toAppError()/getErrorMessage().
        """
        frontend_src = os.path.join(
            os.path.dirname(__file__), "..", "..", "frontend", "src"
        )
        if not os.path.exists(frontend_src):
            pytest.skip("frontend/src not found")

        violations = []
        for root, _dirs, files in os.walk(frontend_src):
            for filename in files:
                if not filename.endswith((".ts", ".tsx")):
                    continue
                if filename.endswith((".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")):
                    continue
                filepath = os.path.join(root, filename)
                with open(filepath) as f:
                    content = f.read()
                # Look for catch (err: any) or catch (error: any) patterns
                import re
                matches = re.findall(
                    r'catch\s*\(\s*\w+\s*:\s*any\s*\)',
                    content
                )
                if matches:
                    rel_path = os.path.relpath(filepath, frontend_src)
                    violations.append(f"{rel_path}: {len(matches)} occurrences")

        assert not violations, (
            f"Files using 'catch (err: any)' instead of 'catch (err: unknown)':\n"
            + "\n".join(violations)
        )


# ===========================================================================
# 7. Makefile Backend Targets
# ===========================================================================


class TestMakefileCorrectness:
    """
    Verify the Makefile uses correct commands for backend targets.

    Regression: Backend targets previously used `npm` commands instead
    of `pip`/`pytest`/`alembic`.
    """

    MAKEFILE_PATH = os.path.join(
        os.path.dirname(__file__), "..", "..", "Makefile"
    )

    def test_makefile_exists(self):
        """The Makefile should exist at the project root."""
        assert os.path.exists(self.MAKEFILE_PATH), "Makefile not found"

    def test_backend_test_uses_pytest(self):
        """Backend test targets should use pytest, not npm test."""
        if not os.path.exists(self.MAKEFILE_PATH):
            pytest.skip("Makefile not found")

        with open(self.MAKEFILE_PATH) as f:
            content = f.read()

        # Check that pytest is used somewhere (for backend testing)
        assert "pytest" in content, (
            "Makefile should use 'pytest' for backend test targets"
        )


# ===========================================================================
# 8. Alembic Migration Chain Integrity
# ===========================================================================


class TestAlembicMigrationChain:
    """
    Verify the Alembic migration chain has no duplicate revision IDs
    and no broken down_revision references.

    Regression: Duplicate revision IDs caused backend startup crashes.
    """

    VERSIONS_DIR = os.path.join(
        os.path.dirname(__file__), "..", "alembic", "versions"
    )

    def _parse_migration_files(self):
        """Parse all migration files to extract revision metadata."""
        if not os.path.exists(self.VERSIONS_DIR):
            pytest.skip("alembic/versions not found")

        migrations = {}
        for filename in os.listdir(self.VERSIONS_DIR):
            if not filename.endswith(".py") or filename.startswith("__"):
                continue
            filepath = os.path.join(self.VERSIONS_DIR, filename)
            with open(filepath) as f:
                content = f.read()

            # Extract revision and down_revision
            import re
            rev_match = re.search(r"^revision\s*[:=]\s*['\"]([^'\"]+)['\"]", content, re.MULTILINE)
            down_match = re.search(r"^down_revision\s*[:=]\s*['\"]([^'\"]*)['\"]", content, re.MULTILINE)
            down_none_match = re.search(r"^down_revision\s*[:=]\s*None", content, re.MULTILINE)

            if rev_match:
                revision = rev_match.group(1)
                down_revision = None
                if down_match:
                    down_revision = down_match.group(1) or None
                elif down_none_match:
                    down_revision = None

                migrations[revision] = {
                    "filename": filename,
                    "down_revision": down_revision,
                }

        return migrations

    def test_no_duplicate_revision_ids(self):
        """Each migration must have a unique revision ID."""
        if not os.path.exists(self.VERSIONS_DIR):
            pytest.skip("alembic/versions not found")

        revisions = defaultdict(list)
        for filename in os.listdir(self.VERSIONS_DIR):
            if not filename.endswith(".py") or filename.startswith("__"):
                continue
            filepath = os.path.join(self.VERSIONS_DIR, filename)
            with open(filepath) as f:
                content = f.read()

            import re
            rev_match = re.search(r"^revision\s*[:=]\s*['\"]([^'\"]+)['\"]", content, re.MULTILINE)
            if rev_match:
                revisions[rev_match.group(1)].append(filename)

        duplicates = {
            rev: files
            for rev, files in revisions.items()
            if len(files) > 1
        }
        assert not duplicates, (
            f"Duplicate Alembic revision IDs (will crash backend startup):\n"
            + "\n".join(
                f"  {rev}: {files}" for rev, files in duplicates.items()
            )
        )

    def test_down_revisions_reference_existing_revisions(self):
        """
        Each migration's down_revision should reference an existing revision
        or be None (for the first migration).
        """
        migrations = self._parse_migration_files()
        if not migrations:
            pytest.skip("No migrations found")

        known_revisions = set(migrations.keys())
        broken = []

        for revision, meta in migrations.items():
            down = meta["down_revision"]
            if down is not None and down not in known_revisions:
                broken.append(
                    f"{meta['filename']}: revision='{revision}' has "
                    f"down_revision='{down}' which does not exist"
                )

        assert not broken, (
            f"Broken migration chain (orphaned down_revisions):\n"
            + "\n".join(broken)
        )

    def test_exactly_one_root_migration(self):
        """
        There should be exactly one migration with down_revision=None
        (the root of the migration chain).
        """
        migrations = self._parse_migration_files()
        if not migrations:
            pytest.skip("No migrations found")

        roots = [
            f"{meta['filename']} (rev: {rev})"
            for rev, meta in migrations.items()
            if meta["down_revision"] is None
        ]

        assert len(roots) == 1, (
            f"Expected exactly 1 root migration (down_revision=None), "
            f"found {len(roots)}:\n" + "\n".join(roots)
        )


# ===========================================================================
# 9. Model Import Completeness
# ===========================================================================


class TestModelImports:
    """
    Verify that all model files are properly imported in models/__init__.py
    so Base.metadata has the complete schema for create_all().
    """

    def test_models_init_imports_all_model_files(self):
        """
        models/__init__.py should import all .py model files to register
        them with Base.metadata.
        """
        models_dir = os.path.join(
            os.path.dirname(__file__), "..", "app", "models"
        )
        init_path = os.path.join(models_dir, "__init__.py")

        assert os.path.exists(init_path), "app/models/__init__.py not found"

        with open(init_path) as f:
            init_source = f.read()

        # Get all .py files in models/ (excluding __init__ and __pycache__)
        model_files = [
            f[:-3]  # Strip .py
            for f in os.listdir(models_dir)
            if f.endswith(".py") and not f.startswith("__")
        ]

        missing = []
        for model_name in model_files:
            # Check if the model is imported (various import patterns)
            patterns = [
                f"from app.models.{model_name} import",
                f"from .{model_name} import",
                f"import app.models.{model_name}",
                f"from app.models import {model_name}",
            ]
            found = any(pattern in init_source for pattern in patterns)
            if not found:
                missing.append(model_name)

        assert not missing, (
            f"Model files not imported in models/__init__.py "
            f"(will be missing from Base.metadata.create_all()):\n"
            + "\n".join(missing)
        )
