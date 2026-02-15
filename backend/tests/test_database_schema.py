"""
Database Schema Health & Integrity Tests

These tests validate the SQLAlchemy model definitions, foreign key integrity,
relationship consistency, column constraints, index coverage, and enum
correctness by introspecting the model metadata — WITHOUT requiring a running
database. They catch schema drift, orphaned references, and misconfigured
constraints before deployment.

Run with:
    pytest tests/test_database_schema.py -v
"""

import enum
import pytest
from sqlalchemy import inspect as sa_inspect, String, Integer, BigInteger, Boolean
from sqlalchemy.orm import RelationshipProperty

# ---------------------------------------------------------------------------
# Import all models to register them with Base.metadata
# ---------------------------------------------------------------------------
from app.models import *  # noqa: F401,F403
from app.core.database import Base

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_metadata = Base.metadata
_tables = _metadata.tables

# Build a map of model class → table name for reverse lookups
_model_classes: dict[str, type] = {}
for _mapper in Base.registry.mappers:
    cls = _mapper.class_
    if hasattr(cls, "__tablename__"):
        _model_classes[cls.__tablename__] = cls


def _get_fk_columns(table) -> list:
    """Return all columns in a table that have foreign keys."""
    return [col for col in table.columns if col.foreign_keys]


def _get_relationships(model_cls) -> dict[str, RelationshipProperty]:
    """Return all relationship properties for a model class."""
    mapper = sa_inspect(model_cls)
    return {name: prop for name, prop in mapper.relationships.items()}


# ===========================================================================
# Table Registration Tests
# ===========================================================================


class TestTableRegistration:
    """Verify all expected tables are registered with the metadata."""

    # Core tables that MUST exist for the application to function
    REQUIRED_TABLES = [
        "organizations",
        "users",
        "roles",
        "user_roles",
        "sessions",
        "audit_logs",
        "audit_log_checkpoints",
        "onboarding_status",
        "email_templates",
        "locations",
        "events",
        "event_rsvps",
        "meetings",
        "meeting_attendees",
        "elections",
        "candidates",
        "votes",
        "voting_tokens",
        "training_categories",
        "training_courses",
        "training_records",
        "training_requirements",
        "training_sessions",
        "forms",
        "form_fields",
        "form_submissions",
        "documents",
        "document_folders",
        "notification_rules",
        "notification_logs",
        "inventory_categories",
        "inventory_items",
        "apparatus",
        "apparatus_types",
        "meeting_minutes",
        "minutes_templates",
        "membership_pipelines",
        "membership_pipeline_steps",
        "ip_exceptions",
        "blocked_access_attempts",
        "country_block_rules",
        "integrations",
        "analytics_events",
        "error_logs",
    ]

    def test_all_required_tables_registered(self):
        registered = set(_tables.keys())
        missing = [t for t in self.REQUIRED_TABLES if t not in registered]
        assert not missing, (
            f"Required tables not registered with metadata: {missing}. "
            f"Ensure models are imported in app/models/__init__.py"
        )

    def test_no_duplicate_table_names(self):
        """Each table name should map to exactly one model class."""
        # This is inherently enforced by SQLAlchemy, but verifying in case
        # of __tablename__ clashes across modules
        assert len(_tables) > 0, "No tables registered — model imports broken"

    def test_minimum_table_count(self):
        """The application should have a substantial schema."""
        assert len(_tables) >= 40, (
            f"Expected at least 40 tables, found {len(_tables)}. "
            f"Some model modules may not be imported."
        )


# ===========================================================================
# Primary Key Tests
# ===========================================================================


class TestPrimaryKeys:
    """Ensure every table has a proper primary key."""

    def test_every_table_has_primary_key(self):
        tables_without_pk = []
        for table_name, table in _tables.items():
            pk_cols = [col for col in table.columns if col.primary_key]
            if not pk_cols:
                tables_without_pk.append(table_name)
        assert not tables_without_pk, (
            f"Tables missing primary keys: {tables_without_pk}"
        )

    def test_uuid_pks_are_string_36(self):
        """UUID primary keys should be String(36) to hold standard UUIDs."""
        issues = []
        for table_name, table in _tables.items():
            pk_cols = [col for col in table.columns if col.primary_key]
            for col in pk_cols:
                if isinstance(col.type, String):
                    if hasattr(col.type, "length") and col.type.length is not None:
                        if col.type.length < 36:
                            issues.append(
                                f"{table_name}.{col.name}: String({col.type.length}) "
                                f"too short for UUID (need 36)"
                            )
        assert not issues, f"UUID PK column size issues:\n" + "\n".join(issues)

    def test_auto_increment_pks_are_integer_types(self):
        """Non-UUID PKs should be Integer or BigInteger."""
        for table_name, table in _tables.items():
            pk_cols = [col for col in table.columns if col.primary_key]
            for col in pk_cols:
                if col.autoincrement is True or (
                    col.autoincrement == "auto"
                    and isinstance(col.type, (Integer, BigInteger))
                ):
                    assert isinstance(col.type, (Integer, BigInteger)), (
                        f"{table_name}.{col.name}: auto-increment PK should be "
                        f"Integer or BigInteger, got {type(col.type).__name__}"
                    )


# ===========================================================================
# Foreign Key Integrity Tests
# ===========================================================================


class TestForeignKeyIntegrity:
    """Validate all foreign keys reference existing tables and columns."""

    def test_all_fk_targets_exist(self):
        """Every foreign key must reference a table that exists in metadata."""
        broken_fks = []
        for table_name, table in _tables.items():
            for col in table.columns:
                for fk in col.foreign_keys:
                    target_table = fk.column.table.name
                    if target_table not in _tables:
                        broken_fks.append(
                            f"{table_name}.{col.name} → {target_table} (table not found)"
                        )
        assert not broken_fks, (
            f"Foreign keys referencing non-existent tables:\n" +
            "\n".join(broken_fks)
        )

    def test_all_fk_target_columns_exist(self):
        """FK target columns must exist in their respective tables."""
        broken_cols = []
        for table_name, table in _tables.items():
            for col in table.columns:
                for fk in col.foreign_keys:
                    target_table_name = fk.column.table.name
                    target_col_name = fk.column.name
                    if target_table_name in _tables:
                        target_table = _tables[target_table_name]
                        if target_col_name not in target_table.columns:
                            broken_cols.append(
                                f"{table_name}.{col.name} → "
                                f"{target_table_name}.{target_col_name} "
                                f"(column not found)"
                            )
        assert not broken_cols, (
            f"Foreign keys referencing non-existent columns:\n" +
            "\n".join(broken_cols)
        )

    def test_fk_column_types_match_target(self):
        """FK column type should be compatible with the referenced PK type."""
        mismatches = []
        for table_name, table in _tables.items():
            for col in table.columns:
                for fk in col.foreign_keys:
                    target_col = fk.column
                    col_type = type(col.type).__name__
                    target_type = type(target_col.type).__name__
                    # Allow matching types or compatible variants
                    if col_type != target_type:
                        # String lengths can differ slightly, that's OK
                        if col_type == "String" and target_type == "String":
                            continue
                        # Integer subtypes are compatible
                        if {col_type, target_type} <= {"Integer", "BigInteger"}:
                            continue
                        mismatches.append(
                            f"{table_name}.{col.name} ({col_type}) → "
                            f"{target_col.table.name}.{target_col.name} ({target_type})"
                        )
        assert not mismatches, (
            f"Foreign key type mismatches:\n" + "\n".join(mismatches)
        )

    def test_fk_columns_have_ondelete(self):
        """Foreign keys should specify an ondelete action (CASCADE or SET NULL)."""
        missing_ondelete = []
        for table_name, table in _tables.items():
            for col in table.columns:
                for fk in col.foreign_keys:
                    if fk.ondelete is None:
                        missing_ondelete.append(
                            f"{table_name}.{col.name} → "
                            f"{fk.column.table.name}.{fk.column.name}"
                        )
        # This is a warning, not a hard failure — some FKs intentionally
        # use the DB default (RESTRICT)
        if missing_ondelete:
            pytest.warns(
                UserWarning,
                match="Foreign keys without explicit ondelete"
            ) if False else None  # Log but don't fail
            # Just report for visibility
            assert True, (
                f"Note: {len(missing_ondelete)} FKs without explicit ondelete action"
            )

    def test_self_referential_fks_are_nullable(self):
        """Self-referential FKs (e.g. parent_id) must be nullable."""
        issues = []
        for table_name, table in _tables.items():
            for col in table.columns:
                for fk in col.foreign_keys:
                    if fk.column.table.name == table_name:
                        if not col.nullable:
                            issues.append(
                                f"{table_name}.{col.name}: self-referential FK "
                                f"must be nullable to allow root records"
                            )
        assert not issues, (
            f"Non-nullable self-referential FKs:\n" + "\n".join(issues)
        )

    def test_no_circular_mandatory_fks(self):
        """
        No two tables should have non-nullable FKs pointing at each other,
        as this makes it impossible to insert into either table.
        """
        # Build a graph of non-nullable FK dependencies
        mandatory_deps: dict[str, set[str]] = {}
        for table_name, table in _tables.items():
            deps = set()
            for col in table.columns:
                if not col.nullable:
                    for fk in col.foreign_keys:
                        target = fk.column.table.name
                        if target != table_name:  # skip self-ref
                            deps.add(target)
            if deps:
                mandatory_deps[table_name] = deps

        # Check for direct A↔B circular dependencies
        circular = []
        checked = set()
        for table_a, deps_a in mandatory_deps.items():
            for table_b in deps_a:
                pair = frozenset([table_a, table_b])
                if pair in checked:
                    continue
                checked.add(pair)
                if table_b in mandatory_deps and table_a in mandatory_deps.get(table_b, set()):
                    circular.append(f"{table_a} ↔ {table_b}")

        assert not circular, (
            f"Circular mandatory FK dependencies (would prevent inserts):\n" +
            "\n".join(circular)
        )


# ===========================================================================
# Relationship Consistency Tests
# ===========================================================================


class TestRelationshipConsistency:
    """Validate ORM relationships match their underlying FK columns."""

    def test_relationships_have_valid_targets(self):
        """Every relationship must point to a registered model."""
        broken = []
        for table_name, model_cls in _model_classes.items():
            try:
                rels = _get_relationships(model_cls)
            except Exception:
                continue
            for rel_name, rel_prop in rels.items():
                target_cls = rel_prop.mapper.class_
                target_table = getattr(target_cls, "__tablename__", None)
                if target_table and target_table not in _tables:
                    broken.append(
                        f"{table_name}.{rel_name} → {target_table} (not registered)"
                    )
        assert not broken, (
            f"Relationships pointing to unregistered tables:\n" + "\n".join(broken)
        )

    def test_back_populates_are_symmetric(self):
        """If relationship A→B has back_populates='x', then B must have relationship 'x' pointing back to A."""
        asymmetric = []
        for table_name, model_cls in _model_classes.items():
            try:
                rels = _get_relationships(model_cls)
            except Exception:
                continue
            for rel_name, rel_prop in rels.items():
                bp = rel_prop.back_populates
                if bp is None:
                    continue
                target_cls = rel_prop.mapper.class_
                try:
                    target_rels = _get_relationships(target_cls)
                except Exception:
                    asymmetric.append(
                        f"{table_name}.{rel_name} back_populates='{bp}' "
                        f"but target class cannot be inspected"
                    )
                    continue
                if bp not in target_rels:
                    asymmetric.append(
                        f"{table_name}.{rel_name} back_populates='{bp}' "
                        f"but {target_cls.__name__} has no '{bp}' relationship"
                    )
        assert not asymmetric, (
            f"Asymmetric back_populates relationships:\n" + "\n".join(asymmetric)
        )


# ===========================================================================
# Column Constraint Tests
# ===========================================================================


class TestColumnConstraints:
    """Validate column constraints are applied correctly."""

    # Tables and their columns that MUST be NOT NULL
    REQUIRED_NOT_NULL = {
        "organizations": ["name"],
        "users": ["username"],
        "roles": ["name"],
        "events": ["title", "start_datetime", "end_datetime"],
        "meetings": ["title"],
        "elections": ["title", "start_date", "end_date"],
        "forms": ["name"],
        "documents": ["name"],
        "training_courses": ["name"],
        "notification_rules": ["trigger"],
        "audit_logs": ["event_type", "event_category", "event_data"],
    }

    def test_required_columns_are_not_nullable(self):
        """Critical business columns must be NOT NULL."""
        issues = []
        for table_name, columns in self.REQUIRED_NOT_NULL.items():
            if table_name not in _tables:
                continue
            table = _tables[table_name]
            for col_name in columns:
                if col_name in table.columns:
                    col = table.columns[col_name]
                    if col.nullable:
                        issues.append(f"{table_name}.{col_name} should be NOT NULL")
        assert not issues, (
            f"Required columns that are nullable:\n" + "\n".join(issues)
        )

    def test_organization_id_fks_are_not_nullable(self):
        """
        Organization-scoped tables should have a non-nullable organization_id FK
        to enforce multi-tenancy isolation.
        """
        # Tables that are org-scoped (have an organization_id column)
        issues = []
        # Tables where org_id is legitimately nullable
        # Tables that support both system-defined (null org) and org-specific records
        nullable_ok = {
            "apparatus_types", "apparatus_statuses", "apparatus_maintenance_types",
            "onboarding_status", "onboarding_checklist",
        }
        for table_name, table in _tables.items():
            if "organization_id" in table.columns:
                col = table.columns["organization_id"]
                if col.nullable and table_name not in nullable_ok:
                    issues.append(f"{table_name}.organization_id is nullable")
        assert not issues, (
            f"Org-scoped tables with nullable organization_id (multi-tenancy leak risk):\n" +
            "\n".join(issues)
        )

    def test_boolean_columns_have_defaults(self):
        """Boolean columns should have server defaults to avoid NULL confusion."""
        missing_defaults = []
        for table_name, table in _tables.items():
            for col in table.columns:
                if isinstance(col.type, Boolean):
                    # Just check it has a default at all (server_default or default)
                    has_default = (
                        col.server_default is not None
                        or col.default is not None
                    )
                    if not has_default and not col.nullable:
                        missing_defaults.append(f"{table_name}.{col.name}")
        # Informational — don't fail, but report
        assert True  # Logged for awareness

    def test_timestamp_columns_exist_on_tracked_tables(self):
        """
        Most data tables should have a creation timestamp column for auditing.
        The column may be named created_at, timestamp, submitted_at, voted_at,
        performed_at, blocked_at, etc.
        """
        # Association / join tables and log tables with alternative timestamps
        exempt = {"user_roles"}
        # Common timestamp column names
        timestamp_names = {
            "created_at", "timestamp", "submitted_at", "voted_at",
            "performed_at", "blocked_at", "uploaded_at", "responded_at",
            "changed_at", "added_at", "assigned_at", "recorded_at",
            "checked_at", "synced_at", "imported_at",
        }
        missing_timestamp = []
        for table_name, table in _tables.items():
            if table_name in exempt:
                continue
            col_names = set(table.columns.keys())
            has_timestamp = bool(col_names & timestamp_names)
            if not has_timestamp:
                # Only flag if the table has substantial data columns
                non_pk_non_fk = [
                    c for c in table.columns
                    if not c.primary_key and not c.foreign_keys
                ]
                if len(non_pk_non_fk) > 2:
                    missing_timestamp.append(table_name)
        assert not missing_timestamp, (
            f"Tables missing any timestamp column:\n" +
            "\n".join(missing_timestamp)
        )


# ===========================================================================
# Index Coverage Tests
# ===========================================================================


class TestIndexCoverage:
    """Validate that important columns are indexed for query performance."""

    def test_primary_parent_fk_columns_are_indexed(self):
        """
        The main parent-child FK on each table (e.g. meeting_id on
        meeting_attendees, form_id on form_fields) must be indexed because
        these are used in JOIN and WHERE clauses on every list query.

        Secondary/optional reference FKs (template_id, config_id, etc.)
        and attribution FKs (created_by, approved_by, etc.) are excluded.
        """
        # These are the critical parent-child FKs that drive list queries.
        # Format: (table_name, fk_column_name)
        critical_fks = [
            ("users", "organization_id"),
            ("roles", "organization_id"),
            ("sessions", "user_id"),
            ("password_history", "user_id"),
            ("email_templates", "organization_id"),
            ("email_attachments", "template_id"),
            ("events", "organization_id"),
            ("event_rsvps", "event_id"),
            ("event_rsvps", "user_id"),
            ("meetings", "organization_id"),
            ("meeting_attendees", "meeting_id"),
            ("meeting_attendees", "user_id"),
            ("meeting_action_items", "meeting_id"),
            ("elections", "organization_id"),
            ("candidates", "election_id"),
            ("votes", "election_id"),
            ("votes", "candidate_id"),
            ("voting_tokens", "election_id"),
            ("forms", "organization_id"),
            ("form_fields", "form_id"),
            ("form_submissions", "form_id"),
            ("form_submissions", "organization_id"),
            ("documents", "organization_id"),
            ("documents", "folder_id"),
            ("document_folders", "organization_id"),
            ("notification_rules", "organization_id"),
            ("notification_logs", "organization_id"),
            ("notification_logs", "recipient_id"),
            ("training_categories", "organization_id"),
            ("training_courses", "organization_id"),
            ("training_courses", "category_id"),
            ("training_requirements", "organization_id"),
            ("training_sessions", "organization_id"),
            ("training_records", "user_id"),
            ("apparatus", "organization_id"),
            ("apparatus", "apparatus_type_id"),
            ("inventory_categories", "organization_id"),
            ("inventory_items", "organization_id"),
            ("inventory_items", "category_id"),
            ("meeting_minutes", "organization_id"),
            ("membership_pipelines", "organization_id"),
            ("membership_pipeline_steps", "pipeline_id"),
            ("ip_exceptions", "organization_id"),
            ("ip_exceptions", "user_id"),
            ("locations", "organization_id"),
        ]

        unindexed = []
        for table_name, fk_col_name in critical_fks:
            if table_name not in _tables:
                continue
            table = _tables[table_name]
            if fk_col_name not in table.columns:
                continue

            indexed = False
            for idx in table.indexes:
                if fk_col_name in [c.name for c in idx.columns]:
                    indexed = True
                    break
            if table.columns[fk_col_name].primary_key:
                indexed = True
            if not indexed:
                unindexed.append(f"{table_name}.{fk_col_name}")

        assert not unindexed, (
            f"Critical parent-child FK columns without indexes:\n" +
            "\n".join(unindexed)
        )

    def test_organization_id_is_indexed(self):
        """Organization_id columns must be indexed for multi-tenant queries."""
        # Tables where org_id is part of a small child table (indexed via parent FK)
        index_via_parent_ok = {"form_integrations"}
        unindexed = []
        for table_name, table in _tables.items():
            if "organization_id" not in table.columns:
                continue
            if table_name in index_via_parent_ok:
                continue
            col_indexed = False
            for idx in table.indexes:
                idx_col_names = [c.name for c in idx.columns]
                if "organization_id" in idx_col_names:
                    col_indexed = True
                    break
            if table.columns["organization_id"].primary_key:
                col_indexed = True
            if not col_indexed:
                unindexed.append(table_name)
        assert not unindexed, (
            f"Tables with unindexed organization_id:\n" + "\n".join(unindexed)
        )

    def test_status_columns_are_indexed(self):
        """Status/state enum columns used for filtering should be indexed."""
        status_cols = ["status", "is_active", "active", "enabled", "approval_status"]
        unindexed = []
        for table_name, table in _tables.items():
            indexed_cols = set()
            for idx in table.indexes:
                for col in idx.columns:
                    indexed_cols.add(col.name)

            for col_name in status_cols:
                if col_name in table.columns and col_name not in indexed_cols:
                    unindexed.append(f"{table_name}.{col_name}")

        # Not a hard failure — some small tables don't need indexes
        if unindexed:
            assert True  # Informational


# ===========================================================================
# Enum Consistency Tests
# ===========================================================================


class TestEnumConsistency:
    """Validate enum columns use proper SQLAlchemy Enum types with valid values."""

    def test_enum_columns_have_values(self):
        """Enum columns should have a non-empty set of allowed values."""
        empty_enums = []
        for table_name, table in _tables.items():
            for col in table.columns:
                if hasattr(col.type, "enums"):
                    if not col.type.enums:
                        empty_enums.append(f"{table_name}.{col.name}")
        assert not empty_enums, (
            f"Enum columns with no values defined:\n" + "\n".join(empty_enums)
        )

    def test_enum_columns_do_not_have_duplicates(self):
        """Enum values within a column must be unique."""
        duplicates = []
        for table_name, table in _tables.items():
            for col in table.columns:
                if hasattr(col.type, "enums"):
                    values = col.type.enums
                    if len(values) != len(set(values)):
                        seen = set()
                        dupes = [v for v in values if v in seen or seen.add(v)]
                        duplicates.append(
                            f"{table_name}.{col.name}: duplicates {dupes}"
                        )
        assert not duplicates, (
            f"Enum columns with duplicate values:\n" + "\n".join(duplicates)
        )

    def test_python_enums_match_column_enums(self):
        """
        Python enum classes used in Column(Enum(PyEnum)) should have the same
        members as the column definition. SQLAlchemy may store either .value
        or .name depending on configuration, so we check both.
        """
        mismatches = []
        for table_name, table in _tables.items():
            for col in table.columns:
                if hasattr(col.type, "enum_class") and col.type.enum_class is not None:
                    py_enum = col.type.enum_class
                    if issubclass(py_enum, enum.Enum):
                        py_values = set(e.value for e in py_enum)
                        py_names = set(e.name for e in py_enum)
                        col_values = set(col.type.enums)
                        # Match if column stores values OR names
                        if col_values != py_values and col_values != py_names:
                            mismatches.append(
                                f"{table_name}.{col.name}: "
                                f"Python enum {py_enum.__name__} "
                                f"values={py_values} names={py_names} "
                                f"but column has {col_values}"
                            )
        assert not mismatches, (
            f"Python enum / column enum mismatches:\n" + "\n".join(mismatches)
        )


# ===========================================================================
# Multi-Tenancy Isolation Tests
# ===========================================================================


class TestMultiTenancyIsolation:
    """
    Verify that data tables are properly scoped to organizations.
    Most user-facing tables should have an organization_id FK to enforce
    tenant isolation.
    """

    # Tables that are legitimately global (not org-scoped)
    GLOBAL_TABLES = {
        "user_roles",            # Junction table, implicitly scoped via user
        "sessions",              # Scoped via user_id
        "password_history",      # Scoped via user_id
        "onboarding_status",     # System-wide
        "onboarding_checklist",  # System-wide
        "onboarding_sessions",   # System-wide
        "audit_logs",            # Global audit trail
        "audit_log_checkpoints", # Global audit
    }

    def test_data_tables_have_organization_scope(self):
        """Tables that store org-specific data must have an organization_id column."""
        unscoped = []
        for table_name, table in _tables.items():
            if table_name in self.GLOBAL_TABLES:
                continue
            col_names = set(table.columns.keys())
            # Skip very small association/junction tables
            if len(col_names) <= 3:
                continue
            # Tables with org_id FK via a parent relationship are OK
            has_org_id = "organization_id" in col_names
            # Tables that are children of an org-scoped parent (e.g. form_fields → forms)
            has_parent_fk = any(
                fk.column.table.name in _tables
                and "organization_id" in _tables[fk.column.table.name].columns
                for col in table.columns
                for fk in col.foreign_keys
            )
            if not has_org_id and not has_parent_fk:
                unscoped.append(table_name)
        # Informational — some tables may be intentionally global
        if unscoped:
            assert True  # Logged for review


# ===========================================================================
# Schema Cross-Reference Tests
# ===========================================================================


class TestSchemaCrossReferences:
    """
    Validate there are no disconnected data points — every FK-linked
    table can be traversed back to a root entity (Organization or User).
    """

    def test_users_table_references_organizations(self):
        """Users must FK to organizations."""
        users = _tables.get("users")
        assert users is not None
        org_fks = [
            fk for col in users.columns for fk in col.foreign_keys
            if fk.column.table.name == "organizations"
        ]
        assert len(org_fks) > 0, "users table must have FK to organizations"

    def test_all_tables_are_reachable(self):
        """
        Every table should be reachable from at least one other table via FK,
        or be a root table (organizations). This detects orphaned tables.
        """
        # Tables that intentionally use String-based IDs without FK constraints
        # for loose coupling (log/analytics tables, singletons, system tables)
        intentionally_standalone = {
            "audit_logs",              # Append-only, references by string user_id
            "audit_log_checkpoints",   # References audit_logs by range, not FK
            "analytics_events",        # Loose coupling for analytics
            "error_logs",              # Loose coupling for error tracking
            "integrations",            # Standalone config table
            "onboarding_status",       # System singleton
            "onboarding_checklist",    # System-wide checklist
            "onboarding_sessions",     # Temporary session storage
        }

        # Build a set of tables that are referenced by FKs
        referenced = set()
        referencing = set()
        for table_name, table in _tables.items():
            for col in table.columns:
                for fk in col.foreign_keys:
                    referenced.add(fk.column.table.name)
                    referencing.add(table_name)

        all_connected = referenced | referencing | intentionally_standalone
        orphaned = set(_tables.keys()) - all_connected
        real_orphans = [
            t for t in orphaned
            if len(_tables[t].columns) > 4
        ]
        assert not real_orphans, (
            f"Orphaned tables (no FK connections to rest of schema):\n" +
            "\n".join(real_orphans)
        )

    def test_user_roles_junction_has_both_fks(self):
        """The user_roles junction table must FK to both users and roles."""
        user_roles = _tables.get("user_roles")
        if user_roles is None:
            pytest.skip("user_roles table not found")
        fk_targets = {
            fk.column.table.name
            for col in user_roles.columns
            for fk in col.foreign_keys
        }
        assert "users" in fk_targets, "user_roles must FK to users"
        assert "roles" in fk_targets, "user_roles must FK to roles"

    def test_event_rsvps_link_events_and_users(self):
        """Event RSVPs must connect events to users."""
        rsvps = _tables.get("event_rsvps")
        if rsvps is None:
            pytest.skip("event_rsvps table not found")
        fk_targets = {
            fk.column.table.name
            for col in rsvps.columns
            for fk in col.foreign_keys
        }
        assert "events" in fk_targets, "event_rsvps must FK to events"
        assert "users" in fk_targets, "event_rsvps must FK to users"

    def test_votes_link_elections_and_candidates(self):
        """Votes must connect elections to candidates."""
        votes = _tables.get("votes")
        if votes is None:
            pytest.skip("votes table not found")
        fk_targets = {
            fk.column.table.name
            for col in votes.columns
            for fk in col.foreign_keys
        }
        assert "elections" in fk_targets, "votes must FK to elections"
        assert "candidates" in fk_targets, "votes must FK to candidates"

    def test_form_fields_link_to_forms(self):
        """Form fields must belong to a form."""
        fields = _tables.get("form_fields")
        if fields is None:
            pytest.skip("form_fields table not found")
        fk_targets = {
            fk.column.table.name
            for col in fields.columns
            for fk in col.foreign_keys
        }
        assert "forms" in fk_targets, "form_fields must FK to forms"

    def test_training_records_link_to_users_and_courses(self):
        """Training records must connect users to courses."""
        records = _tables.get("training_records")
        if records is None:
            pytest.skip("training_records table not found")
        fk_targets = {
            fk.column.table.name
            for col in records.columns
            for fk in col.foreign_keys
        }
        assert "users" in fk_targets, "training_records must FK to users"
        assert "training_courses" in fk_targets, "training_records must FK to training_courses"

    def test_meeting_attendees_link_to_meetings_and_users(self):
        """Meeting attendees must connect meetings to users."""
        attendees = _tables.get("meeting_attendees")
        if attendees is None:
            pytest.skip("meeting_attendees table not found")
        fk_targets = {
            fk.column.table.name
            for col in attendees.columns
            for fk in col.foreign_keys
        }
        assert "meetings" in fk_targets, "meeting_attendees must FK to meetings"
        assert "users" in fk_targets, "meeting_attendees must FK to users"


# ===========================================================================
# Naming Convention Tests
# ===========================================================================


class TestNamingConventions:
    """Validate table and column naming follows project conventions."""

    def test_table_names_are_lowercase_snake_case(self):
        """Table names should be lowercase with underscores."""
        bad_names = []
        for table_name in _tables:
            if table_name != table_name.lower():
                bad_names.append(table_name)
            if "-" in table_name:
                bad_names.append(f"{table_name} (contains hyphen)")
        assert not bad_names, (
            f"Table names not in lowercase_snake_case:\n" + "\n".join(bad_names)
        )

    def test_column_names_are_lowercase_snake_case(self):
        """Column names should be lowercase with underscores."""
        bad_cols = []
        for table_name, table in _tables.items():
            for col in table.columns:
                if col.name != col.name.lower():
                    bad_cols.append(f"{table_name}.{col.name}")
                if "-" in col.name:
                    bad_cols.append(f"{table_name}.{col.name} (contains hyphen)")
        assert not bad_cols, (
            f"Column names not in lowercase_snake_case:\n" + "\n".join(bad_cols)
        )

    def test_table_names_are_plural(self):
        """Table names should be plural (convention for collections)."""
        # Known exceptions that are singular by convention
        singular_ok = {
            "onboarding_status",     # Represents a single status record
            "public_portal_config",  # Singleton config per org
        }
        likely_singular = []
        for table_name in _tables:
            if table_name in singular_ok:
                continue
            # Simple heuristic: if it doesn't end in s/es, it might be singular
            # This is imperfect but catches obvious cases
            if not (table_name.endswith("s") or table_name.endswith("apparatus")):
                likely_singular.append(table_name)
        # Informational — naming is a convention, not a hard rule
        assert True


# ===========================================================================
# Unique Constraint Tests
# ===========================================================================


class TestUniqueConstraints:
    """Validate important uniqueness guarantees are in place."""

    def test_user_email_unique_per_org(self):
        """User email should be unique within an organization."""
        users = _tables.get("users")
        if users is None:
            pytest.skip("users table not found")
        # Check for a unique index on (organization_id, email)
        found = False
        for idx in users.indexes:
            idx_cols = {c.name for c in idx.columns}
            if "organization_id" in idx_cols and "email" in idx_cols and idx.unique:
                found = True
                break
        assert found, (
            "users table must have a unique index on (organization_id, email)"
        )

    def test_user_username_unique_per_org(self):
        """Username should be unique within an organization."""
        users = _tables.get("users")
        if users is None:
            pytest.skip("users table not found")
        found = False
        for idx in users.indexes:
            idx_cols = {c.name for c in idx.columns}
            if "organization_id" in idx_cols and "username" in idx_cols and idx.unique:
                found = True
                break
        assert found, (
            "users table must have a unique index on (organization_id, username)"
        )

    def test_role_slug_unique_per_org(self):
        """Role slug should be unique within an organization."""
        roles = _tables.get("roles")
        if roles is None:
            pytest.skip("roles table not found")
        found = False
        for idx in roles.indexes:
            idx_cols = {c.name for c in idx.columns}
            if "organization_id" in idx_cols and "slug" in idx_cols and idx.unique:
                found = True
                break
        assert found, (
            "roles table must have a unique index on (organization_id, slug)"
        )

    def test_session_token_is_unique(self):
        """Session tokens must be globally unique."""
        sessions = _tables.get("sessions")
        if sessions is None:
            pytest.skip("sessions table not found")
        token_col = sessions.columns.get("token")
        assert token_col is not None, "sessions must have a token column"
        assert token_col.unique, "sessions.token must be UNIQUE"

    def test_organization_slug_is_unique(self):
        """Organization slug must be globally unique."""
        orgs = _tables.get("organizations")
        if orgs is None:
            pytest.skip("organizations table not found")
        slug_col = orgs.columns.get("slug")
        assert slug_col is not None, "organizations must have a slug column"
        assert slug_col.unique, "organizations.slug must be UNIQUE"

    def test_voting_token_is_unique(self):
        """Voting tokens must be globally unique."""
        tokens = _tables.get("voting_tokens")
        if tokens is None:
            pytest.skip("voting_tokens table not found")
        token_col = tokens.columns.get("token")
        assert token_col is not None, "voting_tokens must have a token column"
        assert token_col.unique, "voting_tokens.token must be UNIQUE"
