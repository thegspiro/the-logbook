"""
Prospect Self-Access Privacy Tests

A member must never be able to read the prospective-membership record that
describes them — the file carries interview notes, recommendations and
coordinator commentary written in confidence by other members, and stays
sensitive after the applicant is elected and holds ``prospective_members.view``
in their own right.

Covers the identity-matching rules, the collection-level filtering, and the
structural guarantee that every by-id route inherits the router guard.
"""

import uuid
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.prospect_privacy import (
    block_self_prospect_access,
    load_self_prospect_ids,
    normalize_prospect_id,
)
from app.api.v1.endpoints import membership_pipeline as pipeline_endpoints
from app.models.user import User
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_viewer(db_session: AsyncSession):
    """An organization plus a member who will also appear in the pipeline."""
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Test Dept", "slug": f"test-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, personal_email, date_of_birth, password_hash, status) "
            "VALUES (:id, :org, :un, 'Dana', 'Reyes', :em, :pem, :dob, "
            "'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"dreyes-{org_id[:8]}",
            "em": f"dana.reyes-{org_id[:8]}@dept.example",
            "pem": f"dana-{org_id[:8]}@home.example",
            "dob": date(1988, 4, 11),
        },
    )
    await db_session.flush()

    viewer = await db_session.get(User, user_id)
    return org_id, viewer


async def _make_prospect(svc, org_id, **overrides):
    data = {
        "first_name": "Other",
        "last_name": "Applicant",
        "email": f"other-{_uid()[:8]}@example.com",
    }
    data.update(overrides)
    return await svc.create_prospect(organization_id=org_id, data=data)


# =========================================================================
# 1. Identity matching
# =========================================================================


class TestSelfProspectMatching:

    async def test_matches_department_email_case_insensitively(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(svc, org_id, email=viewer.email.upper())

        hidden = await load_self_prospect_ids(db_session, viewer)

        assert normalize_prospect_id(mine.id) in hidden

    async def test_matches_personal_email(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(svc, org_id, email=viewer.personal_email)

        hidden = await load_self_prospect_ids(db_session, viewer)

        assert normalize_prospect_id(mine.id) in hidden

    async def test_matches_transferred_user_back_link(
        self, db_session: AsyncSession, org_and_viewer
    ):
        """The common case: the applicant was elected and now holds the
        permission that would otherwise show them their own file."""
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(svc, org_id, email="unrelated@example.com")
        mine.transferred_user_id = viewer.id
        await db_session.flush()

        hidden = await load_self_prospect_ids(db_session, viewer)

        assert normalize_prospect_id(mine.id) in hidden

    async def test_matches_full_name_with_matching_date_of_birth(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(
            svc,
            org_id,
            first_name="dana",
            last_name="REYES",
            email="applied-elsewhere@example.com",
            date_of_birth=viewer.date_of_birth,
        )

        hidden = await load_self_prospect_ids(db_session, viewer)

        assert normalize_prospect_id(mine.id) in hidden

    async def test_same_name_different_dob_is_a_different_person(
        self, db_session: AsyncSession, org_and_viewer
    ):
        """A name collision must not hide a real applicant from a coordinator."""
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        namesake = await _make_prospect(
            svc,
            org_id,
            first_name="Dana",
            last_name="Reyes",
            email="dana.reyes.jr@example.com",
            date_of_birth=date(2001, 9, 30),
        )

        hidden = await load_self_prospect_ids(db_session, viewer)

        assert normalize_prospect_id(namesake.id) not in hidden

    async def test_other_org_record_is_not_matched(
        self, db_session: AsyncSession, org_and_viewer
    ):
        _, viewer = org_and_viewer
        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"other-{other_org[:8]}"},
        )
        await db_session.flush()
        svc = MembershipPipelineService(db_session)
        theirs = await _make_prospect(svc, other_org, email=viewer.email)

        hidden = await load_self_prospect_ids(db_session, viewer)

        assert normalize_prospect_id(theirs.id) not in hidden


class TestProspectIdNormalization:
    """MySQL compares ids case-insensitively and FastAPI accepts an
    unhyphenated UUID, so every spelling of an id must canonicalize the same
    way or the guard can be walked past with a re-cased path."""

    def test_uuid_spellings_canonicalize_alike(self):
        canonical = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
        for variant in (
            canonical,
            canonical.upper(),
            canonical.replace("-", ""),
            canonical.replace("-", "").upper(),
            f"  {canonical}  ",
        ):
            assert normalize_prospect_id(variant) == canonical

    def test_non_uuid_falls_back_to_lowercase(self):
        assert normalize_prospect_id("NOT-A-UUID") == "not-a-uuid"


# =========================================================================
# 2. Collection filtering
# =========================================================================


class TestSelfProspectFiltering:

    async def test_list_prospects_omits_self_and_adjusts_total(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        mine = await _make_prospect(
            svc, org_id, email=viewer.email, pipeline_id=pipeline.id
        )
        theirs = await _make_prospect(svc, org_id, pipeline_id=pipeline.id)

        hidden = await load_self_prospect_ids(db_session, viewer)
        items, total = await svc.list_prospects(
            org_id, pipeline_id=pipeline.id, exclude_prospect_ids=hidden
        )

        ids = {p.id for p in items}
        assert mine.id not in ids
        assert theirs.id in ids
        assert total == 1

    async def test_kanban_board_omits_self(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        await svc.add_step(pipeline.id, org_id, {"name": "Application"})
        mine = await _make_prospect(
            svc, org_id, email=viewer.email, pipeline_id=pipeline.id
        )
        theirs = await _make_prospect(svc, org_id, pipeline_id=pipeline.id)

        hidden = await load_self_prospect_ids(db_session, viewer)
        board = await svc.get_kanban_board(
            pipeline.id, org_id, exclude_prospect_ids=hidden
        )

        on_board = {p.id for col in board["columns"] for p in col["prospects"]}
        assert mine.id not in on_board
        assert theirs.id in on_board
        assert board["total_prospects"] == 1

    async def test_stats_counts_exclude_self(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        step = await svc.add_step(pipeline.id, org_id, {"name": "Application"})
        await _make_prospect(svc, org_id, email=viewer.email, pipeline_id=pipeline.id)
        await _make_prospect(svc, org_id, pipeline_id=pipeline.id)

        hidden = await load_self_prospect_ids(db_session, viewer)
        stats = await svc.get_pipeline_stats(
            pipeline.id, org_id, exclude_prospect_ids=hidden
        )

        assert stats["total_prospects"] == 1
        assert stats["active_count"] == 1
        by_step = {s["stage_id"]: s["count"] for s in stats["by_step"]}
        assert by_step[step.id] == 1

    async def test_election_package_list_omits_self(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        mine = await _make_prospect(
            svc, org_id, email=viewer.email, pipeline_id=pipeline.id
        )
        theirs = await _make_prospect(svc, org_id, pipeline_id=pipeline.id)
        for prospect in (mine, theirs):
            await svc.create_election_package(
                prospect_id=prospect.id, organization_id=org_id
            )

        hidden = await load_self_prospect_ids(db_session, viewer)
        packages = await svc.list_election_packages(org_id, exclude_prospect_ids=hidden)

        prospect_ids = {p.prospect_id for p in packages}
        assert mine.id not in prospect_ids
        assert theirs.id in prospect_ids

    async def test_no_exclusions_leaves_results_untouched(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, _ = org_and_viewer
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        await _make_prospect(svc, org_id, pipeline_id=pipeline.id)

        _, total = await svc.list_prospects(
            org_id, pipeline_id=pipeline.id, exclude_prospect_ids=set()
        )

        assert total == 1


# =========================================================================
# 3. Route coverage
# =========================================================================


class TestRouterGuardCoverage:

    def test_guard_is_registered_router_wide(self):
        """Router-wide rather than per endpoint, so a by-id route added later
        cannot silently reopen the hole."""
        registered = {
            dep.dependency
            for dep in pipeline_endpoints.router.dependencies
            if dep.dependency is not None
        }

        assert block_self_prospect_access in registered


class TestGuardOverHttp:
    """End-to-end proof through the real dependency stack: a caller holding
    full ``prospective_members.manage`` is still refused their own file."""

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

    async def _grant_manage(self, db_session, org_id, viewer):
        position_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO positions "
                "(id, organization_id, name, slug, permissions) "
                "VALUES (:id, :org, 'Coordinator', :slug, :perms)"
            ),
            {
                "id": position_id,
                "org": org_id,
                "slug": f"coordinator-{position_id[:8]}",
                "perms": '["prospective_members.manage"]',
            },
        )
        await db_session.execute(
            text(
                "INSERT INTO user_positions (user_id, position_id) "
                "VALUES (:uid, :pid)"
            ),
            {"uid": viewer.id, "pid": position_id},
        )
        await db_session.flush()
        await db_session.refresh(viewer, ["positions"])

    async def test_own_record_is_404_while_another_applicant_is_readable(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        await self._grant_manage(db_session, org_id, viewer)
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(svc, org_id, email=viewer.email)
        theirs = await _make_prospect(svc, org_id)

        async with await self._client(db_session, viewer) as client:
            own = await client.get(f"/prospective-members/prospects/{mine.id}")
            other = await client.get(f"/prospective-members/prospects/{theirs.id}")

        assert own.status_code == 404
        assert other.status_code == 200
        assert other.json()["id"] == theirs.id

    async def test_recased_and_unhyphenated_ids_are_also_refused(
        self, db_session: AsyncSession, org_and_viewer
    ):
        """MySQL matches ids case-insensitively and FastAPI parses an
        unhyphenated UUID, so both spellings must hit the guard."""
        org_id, viewer = org_and_viewer
        await self._grant_manage(db_session, org_id, viewer)
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(svc, org_id, email=viewer.email)

        async with await self._client(db_session, viewer) as client:
            for spelling in (
                mine.id.upper(),
                mine.id.replace("-", ""),
                mine.id.replace("-", "").upper(),
            ):
                res = await client.get(f"/prospective-members/prospects/{spelling}")
                assert res.status_code == 404, spelling

    async def test_mutations_on_own_record_are_refused(
        self, db_session: AsyncSession, org_and_viewer
    ):
        org_id, viewer = org_and_viewer
        await self._grant_manage(db_session, org_id, viewer)
        svc = MembershipPipelineService(db_session)
        mine = await _make_prospect(svc, org_id, email=viewer.email)

        async with await self._client(db_session, viewer) as client:
            advance = await client.post(
                f"/prospective-members/prospects/{mine.id}/advance", json={}
            )
            interview = await client.post(
                f"/prospective-members/prospects/{mine.id}/interviews",
                json={"notes": "self-authored"},
            )
            activity = await client.get(
                f"/prospective-members/prospects/{mine.id}/activity"
            )

        assert advance.status_code == 404
        assert interview.status_code == 404
        assert activity.status_code == 404
