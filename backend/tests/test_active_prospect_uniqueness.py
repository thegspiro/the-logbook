"""Regression tests for active prospect email uniqueness."""

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
