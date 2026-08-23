"""
Prospects-by-source-event tests.

Covers the "which applicants did this event bring in" filter shared by the
event detail card and the pipeline board's "came from" dropdown:

- ``list_prospects(event_id=...)`` includes source metadata and explicit links
- ``list_source_events`` counts distinct applicants and scopes to the org
- the endpoint refuses an event id belonging to another organization

Mocked session — no DB.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services.membership_pipeline_service import MembershipPipelineService


def _compiled(db) -> str:
    """The SQL text of the last statement handed to db.execute."""
    statement = db.execute.await_args_list[-1].args[0]
    return str(statement.compile(compile_kwargs={"literal_binds": False}))


def _compiled_params(db) -> dict:
    statement = db.execute.await_args_list[-1].args[0]
    return statement.compile().params


def _list_db():
    """A session whose execute() serves both the count and the data query."""
    db = AsyncMock()
    result = MagicMock()
    result.scalar.return_value = 0
    result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(return_value=result)
    return db


class TestListProspectsByEvent:
    async def test_event_id_filters_through_source_metadata_or_explicit_link(self):
        db = _list_db()
        await MembershipPipelineService(db).list_prospects(
            organization_id="org-1", event_id="event-1"
        )
        sql = _compiled(db)
        assert "source_event_id" in _compiled_params(db).values()
        assert "prospect_event_links" in sql
        assert "prospect_event_links.prospect_id = prospective_members.id" in sql
        assert "prospective_members.organization_id" in sql

    async def test_without_event_id_no_link_join(self):
        db = _list_db()
        await MembershipPipelineService(db).list_prospects(organization_id="org-1")
        assert "prospect_event_links" not in _compiled(db)


class TestListSourceEvents:
    def _rows_db(self, rows):
        db = AsyncMock()
        result = MagicMock()
        result.all.return_value = rows
        db.execute = AsyncMock(return_value=result)
        return db

    async def test_scopes_both_sides_of_the_join_to_the_org(self):
        db = self._rows_db([])
        await MembershipPipelineService(db).list_source_events("org-1")
        sql = _compiled(db)
        assert "events.organization_id" in sql
        assert "prospective_members.organization_id" in sql

    async def test_counts_distinct_prospects(self):
        db = self._rows_db([])
        await MembershipPipelineService(db).list_source_events("org-1")
        assert "count(distinct" in _compiled(db).lower()

    async def test_uses_source_metadata_not_general_event_links(self):
        db = self._rows_db([])
        await MembershipPipelineService(db).list_source_events("org-1")
        sql = _compiled(db)
        assert "source_event_id" in _compiled_params(db).values()
        assert "prospect_event_links" not in sql

    async def test_excludes_hidden_prospects(self):
        db = self._rows_db([])
        await MembershipPipelineService(db).list_source_events(
            "org-1", exclude_prospect_ids={"private-prospect"}
        )
        sql = _compiled(db)
        assert "prospective_members.id NOT IN" in sql

    async def test_serializes_enum_event_type_to_its_value(self):
        started = datetime(2026, 9, 1, 18, 0, tzinfo=timezone.utc)
        row = SimpleNamespace(
            id="event-1",
            title="Fall Open House",
            event_type=SimpleNamespace(value="recruitment"),
            start_datetime=started,
            prospect_count=9,
        )
        db = self._rows_db([row])
        out = await MembershipPipelineService(db).list_source_events("org-1")
        assert out == [
            {
                "event_id": "event-1",
                "title": "Fall Open House",
                "event_type": "recruitment",
                "start_datetime": started,
                "prospect_count": 9,
            }
        ]

    async def test_missing_count_reads_as_zero_not_none(self):
        db = self._rows_db(
            [
                SimpleNamespace(
                    id="e",
                    title="t",
                    event_type="recruitment",
                    start_datetime=datetime.now(timezone.utc),
                    prospect_count=None,
                )
            ]
        )
        out = await MembershipPipelineService(db).list_source_events("org-1")
        assert out[0]["prospect_count"] == 0


class TestEndpointOrgScoping:
    """``require_permission`` asserts the permission in the caller's own org;
    it says nothing about the event id they passed (CLAUDE.md #14b/#14c)."""

    def _db_returning(self, event_id):
        db = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = event_id
        db.execute = AsyncMock(return_value=result)
        return db

    async def test_rejects_an_event_from_another_organization(self):
        from app.api.v1.endpoints.membership_pipeline import list_prospects

        db = self._db_returning(None)
        user = MagicMock(organization_id="org-1")

        with pytest.raises(HTTPException) as exc:
            await list_prospects(
                pipeline_id=None,
                status_filter=None,
                search=None,
                event_id="00000000-0000-0000-0000-0000000000ff",
                limit=50,
                offset=0,
                db=db,
                current_user=user,
                hidden_prospect_ids=set(),
            )
        assert exc.value.status_code == 404

    async def test_source_events_passes_hidden_prospects_to_service(self):
        from app.api.v1.endpoints.membership_pipeline import (
            list_prospect_source_events,
        )

        db = AsyncMock()
        user = MagicMock(organization_id="org-1")
        with patch(
            "app.api.v1.endpoints.membership_pipeline.MembershipPipelineService"
        ) as service_cls:
            service_cls.return_value.list_source_events = AsyncMock(return_value=[])
            await list_prospect_source_events(
                db=db,
                current_user=user,
                hidden_prospect_ids={"private-prospect"},
            )

        service_cls.return_value.list_source_events.assert_awaited_once_with(
            "org-1", exclude_prospect_ids={"private-prospect"}
        )

    async def test_passes_an_in_org_event_through_to_the_service(self):
        from app.api.v1.endpoints.membership_pipeline import list_prospects

        db = self._db_returning("event-1")
        user = MagicMock(organization_id="org-1")

        with patch(
            "app.api.v1.endpoints.membership_pipeline.MembershipPipelineService"
        ) as service_cls:
            service_cls.return_value.list_prospects = AsyncMock(return_value=([], 0))
            await list_prospects(
                pipeline_id=None,
                status_filter=None,
                search=None,
                event_id="event-1",
                limit=50,
                offset=0,
                db=db,
                current_user=user,
                hidden_prospect_ids=set(),
            )
            kwargs = service_cls.return_value.list_prospects.await_args.kwargs
        assert kwargs["event_id"] == "event-1"
