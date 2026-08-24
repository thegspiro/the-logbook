"""Privacy regression tests for the prospective-member dashboard widget."""

from unittest.mock import AsyncMock, MagicMock

from app.api.v1.endpoints.membership_pipeline import pipeline_widget_summary


async def test_widget_summary_excludes_the_callers_hidden_prospect_records():
    db = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db.execute.return_value = result

    await pipeline_widget_summary(
        db=db,
        current_user=MagicMock(organization_id="org-1"),
        hidden_prospect_ids={"private-prospect"},
    )

    statement = db.execute.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": False}))
    assert "prospective_members.organization_id" in sql
    assert "prospective_members.id NOT IN" in sql
    assert ["private-prospect"] in statement.compile().params.values()
