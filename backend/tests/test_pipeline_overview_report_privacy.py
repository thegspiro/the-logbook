"""`pipeline_overview`'s report must hide the caller's own application.

Every list/aggregate route in `membership_pipeline.py` excludes the caller's
own prospective-membership record via `get_hidden_prospect_ids`
(`app/api/prospect_privacy.py`) -- a member must never read the record that
describes them, even once elected and holding `prospective_members.view` or
`.manage` in their own right (interview notes, references and the vote that
elected them are confidential). `reports_service.py`'s `pipeline_overview`
report was the one lister in this org that never applied that filter: a
coordinator who had once applied through the same pipeline would see their
own name, email and current stage in the "Pipeline Overview" report's
`prospects` list, and their own record would inflate every aggregate
(`total_applicants`, `yearly_trends`, stage counts) it feeds (RPT-29 pass 8).
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import MembershipPipeline, ProspectiveMember
from app.services.reports_service import ReportsService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def pipeline_fixture(db_session: AsyncSession):
    """An org with one pipeline, two applicants: one is the caller's own."""
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    pipeline = MembershipPipeline(
        organization_id=org_id, name="Standard", is_default=True
    )
    db_session.add(pipeline)
    await db_session.flush()

    self_prospect = ProspectiveMember(
        organization_id=org_id,
        pipeline_id=pipeline.id,
        first_name="Cora",
        last_name="Ord",
        email=f"cora-{org_id[:8]}@example.com",
    )
    other_prospect = ProspectiveMember(
        organization_id=org_id,
        pipeline_id=pipeline.id,
        first_name="Dana",
        last_name="Active",
        email=f"dana-{org_id[:8]}@example.com",
    )
    db_session.add_all([self_prospect, other_prospect])
    await db_session.flush()
    return org_id, pipeline, self_prospect, other_prospect


class TestPipelineOverviewHidesSelf:
    async def test_without_hidden_ids_both_applicants_are_listed(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """Baseline: the pre-fix behaviour, for contrast with the fix below."""
        org_id, pipeline, self_prospect, other_prospect = pipeline_fixture
        service = ReportsService(db_session)

        report = await service._generate_pipeline_overview(org_id)

        assert report["total_applicants"] == 2
        names = {p["name"] for p in report["prospects"]}
        assert "Cora Ord" in names
        assert "Dana Active" in names

    async def test_hidden_prospect_id_is_excluded_from_the_list_and_totals(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        org_id, pipeline, self_prospect, other_prospect = pipeline_fixture
        service = ReportsService(db_session)

        report = await service._generate_pipeline_overview(
            org_id, hidden_prospect_ids={self_prospect.id}
        )

        assert report["total_applicants"] == 1
        names = {p["name"] for p in report["prospects"]}
        assert "Cora Ord" not in names
        assert "Dana Active" in names

    async def test_generate_report_dispatch_threads_hidden_ids_through(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """The public dispatcher (`generate_report`), not just the private
        generator, must pass `hidden_prospect_ids` through for this report
        type -- this is what `reports.py`'s endpoints actually call."""
        org_id, pipeline, self_prospect, other_prospect = pipeline_fixture
        service = ReportsService(db_session)

        report = await service.generate_report(
            org_id,
            "pipeline_overview",
            hidden_prospect_ids={self_prospect.id},
        )

        assert report["total_applicants"] == 1
        names = {p["name"] for p in report["prospects"]}
        assert "Cora Ord" not in names

    async def test_other_report_types_ignore_hidden_ids_without_error(
        self, db_session: AsyncSession, pipeline_fixture
    ):
        """`hidden_prospect_ids` is pipeline_overview-specific; every other
        generator must keep its existing signature and not choke on it."""
        org_id, _pipeline, self_prospect, _other = pipeline_fixture
        service = ReportsService(db_session)

        report = await service.generate_report(
            org_id,
            "member_roster",
            hidden_prospect_ids={self_prospect.id},
        )

        assert report["report_type"] == "member_roster"
