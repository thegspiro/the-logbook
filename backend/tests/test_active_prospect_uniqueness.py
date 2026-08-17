"""Regression tests for active prospect email uniqueness."""

import re
from pathlib import Path

from app.models.membership_pipeline import ProspectiveMember

VERSIONS = Path(__file__).parents[1] / "alembic/versions"
ORIGINAL = VERSIONS / "20260812_0003_restore_active_prospect_uniqueness.py"
RECONCILE = VERSIONS / "20260814_0003_reconcile_active_prospect_emails.py"


def test_active_prospect_email_has_database_uniqueness_guard():
    table = ProspectiveMember.__table__

    active_email = table.c.active_email
    assert active_email.computed is not None
    assert "status = 'active'" in str(active_email.computed.sqltext)

    unique_index = next(
        index for index in table.indexes if index.name == "uq_prospect_org_active_email"
    )
    assert unique_index.unique
    assert [column.name for column in unique_index.columns] == [
        "organization_id",
        "active_email",
    ]


def _assert_reconciles_before_creating_index(migration: str):
    reconcile = migration.index("SET duplicate.status = 'inactive'")
    create_index = migration.index("op.create_index(")
    assert "LOWER(TRIM(email))" in migration
    assert "COALESCE(keeper.created_at" in migration
    assert reconcile < create_index


def test_uniqueness_migration_reconciles_legacy_duplicates_first():
    _assert_reconciles_before_creating_index(RECONCILE.read_text())


def test_original_uniqueness_migration_also_reconciles_before_the_index():
    """An install upgrading from 20260812_0002 with legacy duplicate active
    emails runs 20260812_0003 first — if that migration created the unique
    index without reconciling, the upgrade would fail inside it and never
    reach the cleanup in 20260814_0003. The repair is therefore duplicated
    into the earlier migration; installs already stamped past it never re-run
    it, so the duplication only hardens fresh upgrade paths."""
    _assert_reconciles_before_creating_index(ORIGINAL.read_text())


def test_duplicated_reconciliation_blocks_do_not_drift():
    """The repair exists twice on purpose (see above) — but it must stay the
    same repair, or the two upgrade paths converge on different data."""

    def _reconciliation_block(source: str) -> str:
        start = source.index("UPDATE prospective_members AS duplicate")
        marker = "SET duplicate.status = 'inactive'"
        end = source.index(marker) + len(marker)
        # Normalize the quoting/whitespace of concatenated string literals.
        return re.sub(r"[\s\"']+", " ", source[start:end])

    assert _reconciliation_block(ORIGINAL.read_text()) == _reconciliation_block(
        RECONCILE.read_text()
    )
