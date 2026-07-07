"""
Static (no-DB) guards for the department-template registry.

These enforce the security invariants from the plan's threat model (§8) at the
schema level, so a future model change that would leak secrets/PII or lose a
scrub is caught in CI rather than in production.
"""

from app.services.org_template_registry import (
    INCLUDE_SPECS,
    INCLUDED_TABLES,
    SECRET_COLUMN_PATTERNS,
    USERS_TABLE,
    modules,
    specs_for_modules,
)
from app.services.org_template_service import (
    _parent_table,
    null_columns_for,
)


def test_specs_have_unique_tables():
    tables = [s.tablename for s in INCLUDE_SPECS]
    assert len(tables) == len(set(tables)), "Duplicate TableSpec for a table"


def test_no_secret_columns_in_include_set():
    """S6/§8.1: no INCLUDE table may carry a secret/credential column."""
    offenders = []
    for spec in INCLUDE_SPECS:
        for col in spec.model.__table__.columns:
            name = col.name.lower()
            if any(pattern in name for pattern in SECRET_COLUMN_PATTERNS):
                offenders.append(f"{spec.tablename}.{col.name}")
    assert not offenders, f"Secret-pattern columns in INCLUDE set: {offenders}"


def test_all_user_fk_columns_are_nulled_on_export():
    """S8/§8.2: every FK to the users table is scrubbed (fail-closed)."""
    for spec in INCLUDE_SPECS:
        user_fks = {
            col.name
            for col in spec.model.__table__.columns
            for fk in col.foreign_keys
            if fk.column.table.name == USERS_TABLE
        }
        leaked = user_fks - null_columns_for(spec)
        assert not leaked, f"{spec.tablename} would leak user FK columns: {leaked}"


def test_org_scoped_specs_have_organization_id():
    for spec in INCLUDE_SPECS:
        if spec.parent_fk is None:
            assert (
                "organization_id" in spec.model.__table__.columns
            ), f"{spec.tablename} is org-scoped but has no organization_id"


def test_parent_scoped_specs_resolve_to_included_parent():
    """Parent-scoped tables must hang off another INCLUDE table (closure/ordering)."""
    for spec in INCLUDE_SPECS:
        if spec.parent_fk is not None:
            assert (
                spec.parent_fk in spec.model.__table__.columns
            ), f"{spec.tablename}.{spec.parent_fk} is not a column"
            parent = _parent_table(spec)
            assert (
                parent in INCLUDED_TABLES
            ), f"{spec.tablename} parent {parent} is not in the INCLUDE set"


def test_all_fk_targets_are_resolvable():
    """Every FK on every INCLUDE model resolves to a known table (no fail-open)."""
    for spec in INCLUDE_SPECS:
        for col in spec.model.__table__.columns:
            for fk in col.foreign_keys:
                assert (
                    fk.column.table.name
                ), f"Unresolvable FK on {spec.tablename}.{col.name}"


def test_module_filter_is_a_subset():
    all_specs = set(s.tablename for s in specs_for_modules(None))
    assert all_specs == INCLUDED_TABLES
    for module in modules():
        subset = specs_for_modules({module})
        assert subset, f"module {module} has no specs"
        assert all(s.module == module for s in subset)
