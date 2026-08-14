"""Regression tests for active prospect email uniqueness."""

from pathlib import Path

from app.models.membership_pipeline import ProspectiveMember


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


def test_uniqueness_migration_reconciles_legacy_duplicates_first():
    migration = (
        Path(__file__).parents[1]
        / "alembic/versions/20260814_0003_reconcile_active_prospect_emails.py"
    ).read_text()

    reconcile = migration.index("SET duplicate.status = 'inactive'")
    create_index = migration.index("op.create_index(")
    assert "LOWER(TRIM(email))" in migration
    assert "COALESCE(keeper.created_at" in migration
    assert reconcile < create_index


def test_released_uniqueness_migration_is_not_rewritten_with_data_repairs():
    released = (
        Path(__file__).parents[1]
        / "alembic/versions/20260812_0003_restore_active_prospect_uniqueness.py"
    ).read_text()

    assert "LOWER(TRIM(email))" not in released
    assert "SET duplicate.status" not in released
