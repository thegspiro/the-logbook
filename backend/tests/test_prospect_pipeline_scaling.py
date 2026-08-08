"""
Prospect Pipeline Scaling Tests

Two read paths that grew per-prospect cost:

* ``process_inactivity_warnings`` ran one activity-log SELECT per stale
  prospect plus one UPDATE each, over every stale prospect in the
  organization — so the cost of deciding it had nothing to do scaled with how
  neglected the pipeline was.
* ``get_kanban_board`` loaded every active prospect for a pipeline with no
  ceiling.

These assert the observable behavior (query counts, and correct results at the
cap) rather than the shape of the SQL.
"""

import uuid

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import ProspectStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


class QueryCounter:
    """Count SQL statements issued on a session's underlying connection."""

    def __init__(self, session: AsyncSession):
        self._sync_engine = session.get_bind().engine
        self.count = 0

    def _on_execute(self, *args, **kwargs):
        self.count += 1

    def __enter__(self):
        event.listen(self._sync_engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc):
        event.remove(self._sync_engine, "before_cursor_execute", self._on_execute)
        return False


@pytest.fixture
async def org_and_admin(db_session: AsyncSession):
    org_id = _uid()
    admin_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Admin', 'User', :em, 'hashed', 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"admin-{org_id[:8]}",
            "em": f"admin-{org_id[:8]}@test.example",
        },
    )
    await db_session.flush()
    return org_id, admin_id


async def _stale_pipeline(svc, db_session, org_id, prospect_count):
    """A pipeline whose prospects are all long past their inactivity timeout."""
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Stale")
    await svc.update_pipeline(
        pipeline.id,
        org_id,
        {"inactivity_config": {"timeout_preset": "3_months"}},
    )
    await svc.add_step(pipeline.id, org_id, {"name": "Application"})

    ids = []
    for i in range(prospect_count):
        p = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Stale",
                "last_name": f"Applicant{i}",
                "email": f"stale-{i}-{_uid()[:6]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )
        ids.append(p.id)

    # Age them past the 90-day timeout.
    await db_session.execute(
        text(
            "UPDATE prospective_members SET created_at = created_at - "
            "INTERVAL 200 DAY, updated_at = updated_at - INTERVAL 200 DAY "
            "WHERE pipeline_id = :pid"
        ),
        {"pid": pipeline.id},
    )
    await db_session.commit()
    return pipeline, ids


class TestInactivityProcessingScales:

    async def test_query_count_does_not_grow_with_the_number_of_prospects(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Measured at two sizes and compared, rather than against a
        hand-picked threshold: the claim is that cost is independent of the
        prospect count, so that is what gets asserted.

        The previous implementation issued one SELECT plus one UPDATE per
        stale prospect, so this would have been roughly 2x apart.
        """
        small_org, small_admin = org_and_admin
        svc = MembershipPipelineService(db_session)
        await _stale_pipeline(svc, db_session, small_org, prospect_count=4)

        big_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug,"
                " timezone) VALUES (:id, 'Big', 'fire_department', :slug, 'UTC')"
            ),
            {"id": big_org, "slug": f"b-{big_org[:8]}"},
        )
        await db_session.flush()
        await _stale_pipeline(svc, db_session, big_org, prospect_count=20)

        with QueryCounter(db_session) as counter:
            small = await svc.process_inactivity_warnings(small_org, small_admin)
        small_queries = counter.count

        with QueryCounter(db_session) as counter:
            big = await svc.process_inactivity_warnings(big_org, small_admin)
        big_queries = counter.count

        assert small["marked_inactive"] == 4
        assert big["marked_inactive"] == 20
        assert big_queries == small_queries, (
            f"query count scaled with prospects: {small_queries} for 4, "
            f"{big_queries} for 20"
        )

    async def test_a_second_run_marks_nothing_again(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        await _stale_pipeline(svc, db_session, org_id, prospect_count=4)

        first = await svc.process_inactivity_warnings(org_id, admin_id)
        second = await svc.process_inactivity_warnings(org_id, admin_id)

        assert first["marked_inactive"] == 4
        # They are INACTIVE now, so check_inactivity no longer returns them.
        assert second["marked_inactive"] == 0

    async def test_prospects_really_are_marked_inactive(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        _, ids = await _stale_pipeline(svc, db_session, org_id, prospect_count=3)

        await svc.process_inactivity_warnings(org_id, admin_id)

        for pid in ids:
            assert (await svc.get_prospect(pid, org_id)).status == (
                ProspectStatus.INACTIVE
            )

    async def test_an_empty_pipeline_short_circuits(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)

        result = await svc.process_inactivity_warnings(org_id, admin_id)

        assert result == {
            "warnings_sent": 0,
            "marked_inactive": 0,
            "total_checked": 0,
        }


class TestKanbanIsBounded:

    async def test_cards_are_capped_but_counts_stay_true(
        self, db_session: AsyncSession, org_and_admin, monkeypatch
    ):
        """A truncated board must not under-report its columns — the count is
        what a coordinator reads off the header."""
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        monkeypatch.setattr(MembershipPipelineService, "MAX_KANBAN_CARDS", 3)

        pipeline = await svc.create_pipeline(organization_id=org_id, name="Busy")
        step = await svc.add_step(pipeline.id, org_id, {"name": "Application"})
        for i in range(7):
            await svc.create_prospect(
                organization_id=org_id,
                data={
                    "first_name": "A",
                    "last_name": f"B{i}",
                    "email": f"b{i}-{_uid()[:6]}@example.com",
                    "pipeline_id": pipeline.id,
                },
            )

        board = await svc.get_kanban_board(pipeline.id, org_id)

        assert board["total_prospects"] == 7
        assert board["returned_prospects"] == 3
        assert board["truncated"] is True
        column = next(c for c in board["columns"] if c["step"] is not None)
        assert column["count"] == 7, "column count must reflect reality, not the page"
        assert len(column["prospects"]) == 3
        assert str(column["step"].id) == str(step.id)

    async def test_an_untruncated_board_says_so(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="Quiet")
        await svc.add_step(pipeline.id, org_id, {"name": "Application"})
        await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Solo",
                "last_name": "Applicant",
                "email": f"solo-{_uid()[:6]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )

        board = await svc.get_kanban_board(pipeline.id, org_id)

        assert board["total_prospects"] == 1
        assert board["returned_prospects"] == 1
        assert board["truncated"] is False

    async def test_the_excluded_self_record_is_absent_from_counts_too(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The privacy exclusion has to reach the aggregate, or the column
        header would betray the presence of the hidden record."""
        org_id, _ = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        await svc.add_step(pipeline.id, org_id, {"name": "Application"})
        hidden = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Hidden",
                "last_name": "Self",
                "email": f"self-{_uid()[:6]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )
        await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Visible",
                "last_name": "Other",
                "email": f"other-{_uid()[:6]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )

        board = await svc.get_kanban_board(
            pipeline.id, org_id, exclude_prospect_ids={hidden.id}
        )

        assert board["total_prospects"] == 1
        column = next(c for c in board["columns"] if c["step"] is not None)
        assert column["count"] == 1


class TestKanbanResponseShape:
    """The endpoint returned a bare dict, so FastAPI serialized every column
    of ``ProspectiveMember`` — including ``status_token``, the credential
    behind the public application-status page."""

    async def _client(self, db_session, viewer):
        from fastapi import FastAPI
        from httpx import ASGITransport, AsyncClient

        from app.api.dependencies import get_current_user
        from app.api.v1.endpoints import membership_pipeline as endpoints
        from app.core.database import get_db

        app = FastAPI()
        app.include_router(endpoints.router, prefix="/prospective-members")
        app.dependency_overrides[get_current_user] = lambda: viewer
        app.dependency_overrides[get_db] = lambda: db_session
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    async def test_cards_never_carry_the_status_token_or_private_fields(
        self, db_session: AsyncSession, org_and_admin
    ):
        from app.models.user import User

        org_id, admin_id = org_and_admin
        position_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO positions (id, organization_id, name, slug, permissions)"
                " VALUES (:id, :org, 'Coord', :slug, :perms)"
            ),
            {
                "id": position_id,
                "org": org_id,
                "slug": f"coord-{position_id[:8]}",
                "perms": '["prospective_members.view"]',
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO user_positions (user_id, position_id)"
                " VALUES (:uid, :pid)"
            ),
            {"uid": admin_id, "pid": position_id},
        )
        await db_session.flush()
        viewer = await db_session.get(User, admin_id)
        await db_session.refresh(viewer, ["positions"])

        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        await svc.add_step(pipeline.id, org_id, {"name": "Application"})
        await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Ann",
                "last_name": "Lee",
                "email": f"ann-{_uid()[:6]}@example.com",
                "pipeline_id": pipeline.id,
                "notes": "Confidential coordinator note",
                "address_street": "1 Main St",
            },
        )

        async with await self._client(db_session, viewer) as client:
            res = await client.get(
                f"/prospective-members/pipelines/{pipeline.id}/kanban"
            )

        assert res.status_code == 200
        body = res.json()
        cards = [c for col in body["columns"] for c in col["prospects"]]
        assert cards, "expected a card on the board"
        leaked = {
            "status_token",
            "status_token_created_at",
            "notes",
            "date_of_birth",
            "address_street",
            "address_city",
            "address_zip",
            "metadata_",
            "interest_reason",
        } & set(cards[0])
        assert leaked == set(), f"kanban card exposes private fields: {leaked}"
        # And it still carries what a card actually renders.
        assert cards[0]["first_name"] == "Ann"
        assert "days_in_stage" in cards[0]
        assert body["truncated"] is False
