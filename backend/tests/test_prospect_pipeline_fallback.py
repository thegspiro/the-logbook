"""An applicant with no explicit pipeline lands on a board (W23-1).

``create_prospect`` placed a pipeline-less applicant (a guest sign-in) on the
organization's *default* pipeline only, so a department whose one pipeline was
never marked default collected applicants on no board. It now falls back to
the first active, non-template pipeline.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectStepProgress,
)
from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Fallback FD",
        slug=f"fallback-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _pipeline(
    db_session, org, *, days=0, default=False, active=True, template=False
):
    pipeline = MembershipPipeline(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"P{days}",
        is_default=default,
        is_active=active,
        is_template=template,
        created_at=T0 + timedelta(days=days),
    )
    db_session.add(pipeline)
    await db_session.flush()
    for order in (2, 1):
        db_session.add(
            MembershipPipelineStep(
                id=str(uuid.uuid4()),
                pipeline_id=pipeline.id,
                name=f"Step {order}",
                sort_order=order,
            )
        )
    await db_session.flush()
    return pipeline


async def _create(db_session, org):
    return await MembershipPipelineService(db_session).create_prospect(
        org.id,
        {
            "first_name": "Guest",
            "last_name": "Walkin",
            "email": f"{uuid.uuid4().hex[:8]}@guest.test",
        },
        None,
    )


async def test_no_default_falls_back_to_the_first_active_pipeline(db_session):
    org = await _org(db_session)
    await _pipeline(db_session, org, days=0, template=True)
    await _pipeline(db_session, org, days=1, active=False)
    first = await _pipeline(db_session, org, days=2)
    await _pipeline(db_session, org, days=3)

    prospect = await _create(db_session, org)

    assert prospect.pipeline_id == first.id
    assert prospect.current_step is not None
    assert prospect.current_step.name == "Step 1"
    progress = (
        await db_session.execute(
            ProspectStepProgress.__table__.select().where(
                ProspectStepProgress.prospect_id == prospect.id
            )
        )
    ).all()
    assert len(progress) == 2


async def test_a_default_pipeline_still_wins(db_session):
    org = await _org(db_session)
    await _pipeline(db_session, org, days=0)
    default = await _pipeline(db_session, org, days=5, default=True)

    prospect = await _create(db_session, org)

    assert prospect.pipeline_id == default.id


async def test_no_usable_pipeline_leaves_it_unplaced(db_session):
    org = await _org(db_session)
    await _pipeline(db_session, org, template=True)

    prospect = await _create(db_session, org)

    assert prospect.pipeline_id is None
