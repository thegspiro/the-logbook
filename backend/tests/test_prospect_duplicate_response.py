"""
Duplicate-applicant creation returns the existing record, not a 500.

``create_prospect`` deliberately does not fail when an active applicant already
holds that email: it notifies the applicant, logs the collision, and returns the
existing record so the coordinator sees who it is. The prospective-members guide
documents that behavior ("If another applicant exists → warning with applicant
details").

It answered **500** instead. The duplicate lookup did not eager-load
``current_step`` or ``step_progress``, and ``ProspectResponse`` reads both — so
FastAPI's response serialization triggered a lazy load from the async response
path, which raises ``MissingGreenlet`` rather than merely being slow. The normal
create path loads them; only the duplicate path did not.

This asserts the relationships are loaded on the returned instance, which is
what serialization needs and what the lazy load would otherwise have to fetch.
"""

import uuid

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]

# The relationships ProspectResponse reads. Serialization touches these
# attributes, so an unloaded one is a lazy load from the response path.
RESPONSE_RELATIONSHIPS = ("current_step", "step_progress")


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_id(db_session: AsyncSession):
    oid = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": oid, "slug": f"d-{oid[:8]}"},
    )
    await db_session.flush()
    return oid


async def _pipeline_with_steps(svc, organization_id):
    pipeline = await svc.create_pipeline(
        organization_id=organization_id, name="Volunteer"
    )
    await svc.add_step(pipeline.id, organization_id, {"name": "Application"})
    await svc.add_step(pipeline.id, organization_id, {"name": "Interview"})
    return pipeline


def _unloaded(instance) -> set:
    """Relationship names SQLAlchemy would have to go to the database for."""
    return set(sa_inspect(instance).unloaded)


class TestDuplicateProspectIsSerializable:

    async def test_duplicate_returns_the_existing_prospect(
        self, db_session: AsyncSession, org_id
    ):
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline_with_steps(svc, org_id)
        email = f"dup-{_uid()[:8]}@example.com"

        first = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Alex",
                "last_name": "Rivera",
                "email": email,
                "pipeline_id": pipeline.id,
            },
        )
        second = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Alex",
                "last_name": "Rivera",
                "email": email,
                "pipeline_id": pipeline.id,
            },
        )

        assert second.id == first.id, "a duplicate must not create a second record"

    async def test_the_returned_duplicate_needs_no_lazy_load(
        self, db_session: AsyncSession, org_id
    ):
        """The regression: these unloaded is a 500 from the response path."""
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline_with_steps(svc, org_id)
        email = f"dup-{_uid()[:8]}@example.com"

        data = {
            "first_name": "Alex",
            "last_name": "Rivera",
            "email": email,
            "pipeline_id": pipeline.id,
        }
        await svc.create_prospect(organization_id=org_id, data=data)
        duplicate = await svc.create_prospect(organization_id=org_id, data=data)

        unloaded = _unloaded(duplicate)
        missing = [rel for rel in RESPONSE_RELATIONSHIPS if rel in unloaded]
        assert not missing, (
            f"{missing} would lazy-load during response serialization, which "
            "raises MissingGreenlet on the async path"
        )

    async def test_a_first_time_prospect_is_also_serializable(
        self, db_session: AsyncSession, org_id
    ):
        """Pins the non-duplicate path too, so a fix here cannot regress it."""
        svc = MembershipPipelineService(db_session)
        pipeline = await _pipeline_with_steps(svc, org_id)

        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Jordan",
                "last_name": "Vale",
                "email": f"new-{_uid()[:8]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )

        unloaded = _unloaded(prospect)
        assert not [rel for rel in RESPONSE_RELATIONSHIPS if rel in unloaded]
