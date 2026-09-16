"""Pipeline stat header counts the same applicants the list shows.

The stat cards and the applicant table were two queries with two different
scopes: the header counted the whole pipeline while the table counted the
filtered set. A search or a "came from" filter matching nothing therefore left
"Total Active: 2" standing over an empty table, which reads as lost applicants
rather than as a filter doing its job.

``get_pipeline_stats`` now takes the same ``search`` and ``event_id`` the list
takes, through the same predicate builder, so the two cannot drift. ``status``
is deliberately *not* among them: it filters the open-pipeline view alone, and
counting through it would zero the archive badges the same response feeds.
"""

import inspect
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import membership_pipeline as pipeline_endpoints
from app.models.membership_pipeline import (
    MembershipPipeline,
    ProspectEventLink,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import User
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_event(db_session: AsyncSession, org_id: str, title: str) -> str:
    event_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, reminder_schedule) "
            "VALUES (:id, :org, :title, 'other', NOW(), NOW(), '[]')"
        ),
        {"id": event_id, "org": org_id, "title": title},
    )
    return event_id


@pytest.fixture
async def pipeline_fixture(db_session: AsyncSession):
    """An org with one pipeline: 2 active, 2 rejected — the reported shape."""
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    pipeline = MembershipPipeline(organization_id=org_id, name="Standard")
    db_session.add(pipeline)
    await db_session.flush()

    people = []
    for first, last, status in (
        ("Dana", "Active", ProspectStatus.ACTIVE),
        ("Reese", "Active", ProspectStatus.ACTIVE),
        ("Alex", "Rejected", ProspectStatus.REJECTED),
        ("Blair", "Rejected", ProspectStatus.REJECTED),
    ):
        person = ProspectiveMember(
            organization_id=org_id,
            pipeline_id=pipeline.id,
            first_name=first,
            last_name=last,
            email=f"{first.lower()}-{org_id[:8]}@example.com",
            status=status,
        )
        db_session.add(person)
        people.append(person)
    await db_session.flush()
    return org_id, pipeline, people


class TestStatsRespectFilters:
    async def test_unfiltered_counts_the_whole_pipeline(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """The pre-existing contract: no filters, whole-pipeline counts."""
        org_id, pipeline, _ = pipeline_fixture
        stats = await MembershipPipelineService(db_session).get_pipeline_stats(
            pipeline.id, org_id
        )
        assert stats is not None
        assert stats["active_count"] == 2
        assert stats["rejected_count"] == 2
        assert stats["total_prospects"] == 4

    async def test_search_narrows_the_counts_to_match_the_list(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        org_id, pipeline, _ = pipeline_fixture
        service = MembershipPipelineService(db_session)

        stats = await service.get_pipeline_stats(pipeline.id, org_id, search="Dana")
        _, listed = await service.list_prospects(
            organization_id=org_id,
            pipeline_id=pipeline.id,
            search="Dana",
            open_only=True,
        )

        assert stats is not None
        assert stats["active_count"] == 1
        assert listed == 1, "the header and the list must agree"
        assert stats["rejected_count"] == 0

    async def test_search_matching_nobody_reports_zero_not_the_pipeline(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """The reported bug: an empty table under a non-zero header."""
        org_id, pipeline, _ = pipeline_fixture
        service = MembershipPipelineService(db_session)

        stats = await service.get_pipeline_stats(pipeline.id, org_id, search="Nobody")
        _, listed = await service.list_prospects(
            organization_id=org_id,
            pipeline_id=pipeline.id,
            search="Nobody",
            open_only=True,
        )

        assert stats is not None
        assert listed == 0
        assert stats["active_count"] == 0
        assert stats["total_prospects"] == 0

    async def test_event_filter_counts_metadata_and_explicit_links(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """The same OR the list uses: creation provenance or an explicit link."""
        org_id, pipeline, people = pipeline_fixture
        dana, reese = people[0], people[1]
        event_id = await _make_event(db_session, org_id, "Open House")

        dana.metadata_ = {"source_event_id": event_id}
        db_session.add(ProspectEventLink(prospect_id=reese.id, event_id=event_id))
        await db_session.flush()

        service = MembershipPipelineService(db_session)
        stats = await service.get_pipeline_stats(pipeline.id, org_id, event_id=event_id)
        _, listed = await service.list_prospects(
            organization_id=org_id,
            pipeline_id=pipeline.id,
            event_id=event_id,
            open_only=True,
        )

        assert stats is not None
        assert stats["active_count"] == 2
        assert listed == 2
        assert stats["rejected_count"] == 0

    async def test_status_does_not_narrow_the_archive_badges(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """The Rejected/Withdrawn/Converted badges read off this same response.

        Counting through the caller's status filter would zero them the moment
        a coordinator filtered the open view to "on hold".
        """
        org_id, pipeline, _ = pipeline_fixture
        stats = await MembershipPipelineService(db_session).get_pipeline_stats(
            pipeline.id, org_id
        )
        assert stats is not None
        assert stats["rejected_count"] == 2

        # Stated against the signature so adding a status parameter here is a
        # deliberate act rather than something a refactor can do quietly.
        accepted = inspect.signature(
            MembershipPipelineService.get_pipeline_stats
        ).parameters
        assert "status" not in accepted
        assert {"search", "event_id"} <= set(accepted)


class TestStatsEndpointScopesTheEvent:
    """A client-supplied FK is confirmed in-org before it is counted through."""

    async def _client(self, db_session, viewer):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.core.database import get_db

        app = FastAPI()
        app.include_router(pipeline_endpoints.router, prefix="/prospective-members")
        app.dependency_overrides[get_current_user] = lambda: viewer
        app.dependency_overrides[get_db] = lambda: db_session
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def _viewer(self, db_session: AsyncSession, org_id: str) -> User:
        viewer_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Cora', 'Ord', :em, 'hashed', 'active')"
            ),
            {
                "id": viewer_id,
                "org": org_id,
                "un": f"cora-{viewer_id[:8]}",
                "em": f"cora-{viewer_id[:8]}@test.example",
            },
        )
        position_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions)"
                " VALUES (:id, :org, 'Coordinator', :slug, :perms)"
            ),
            {
                "id": position_id,
                "org": org_id,
                "slug": f"coordinator-{position_id[:8]}",
                "perms": '["prospective_members.manage"]',
            },
        )
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": viewer_id, "p": position_id},
        )
        await db_session.flush()
        viewer = await db_session.get(User, viewer_id)
        await db_session.refresh(viewer, ["positions"])
        return viewer

    async def test_another_orgs_event_is_404_not_an_empty_count(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        org_id, pipeline, _ = pipeline_fixture
        viewer = await self._viewer(db_session, org_id)

        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"o-{other_org[:8]}"},
        )
        foreign_event = await _make_event(db_session, other_org, "Their Open House")
        await db_session.flush()

        client = await self._client(db_session, viewer)
        async with client:
            response = await client.get(
                f"/prospective-members/pipelines/{pipeline.id}/stats",
                params={"event_id": foreign_event},
            )
        assert response.status_code == 404

    async def test_omitting_the_filters_preserves_the_old_response(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """Backward compatibility: a client written before the params exists."""
        org_id, pipeline, _ = pipeline_fixture
        viewer = await self._viewer(db_session, org_id)

        client = await self._client(db_session, viewer)
        async with client:
            response = await client.get(
                f"/prospective-members/pipelines/{pipeline.id}/stats"
            )
        assert response.status_code == 200
        body = response.json()
        assert body["active_count"] == 2
        assert body["rejected_count"] == 2
