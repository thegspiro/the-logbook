"""The "show upcoming stages" status-page setting persists through the service.

A department switches it from Pipeline Settings; this checks the column the
switch writes defaults to showing stages (what the status page did before the
setting existed), that it round-trips through update_pipeline, and that an
explicit null is refused rather than written into a NOT NULL column.
"""

import uuid

import pytest

from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = pytest.mark.integration


async def _pipeline(db_session):
    org = Organization(
        name="Future Stages VFD", slug=f"future-stages-{uuid.uuid4().hex[:10]}"
    )
    db_session.add(org)
    await db_session.flush()
    org_id = str(org.id)
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruit")
    return svc, org_id, str(pipeline.id), pipeline.public_show_future_stages


async def test_new_pipeline_shows_future_stages(db_session):
    _, _, _, show_future = await _pipeline(db_session)

    assert show_future is True


async def test_setting_round_trips_through_update(db_session):
    svc, org_id, pipeline_id, _ = await _pipeline(db_session)

    updated = await svc.update_pipeline(
        pipeline_id, org_id, {"public_show_future_stages": False}
    )

    assert updated.public_show_future_stages is False


async def test_explicit_null_is_refused(db_session):
    svc, org_id, pipeline_id, _ = await _pipeline(db_session)

    with pytest.raises(
        ValueError, match="'public_show_future_stages' cannot be cleared"
    ):
        await svc.update_pipeline(
            pipeline_id, org_id, {"public_show_future_stages": None}
        )
