"""
Database-backed test for deleting a grant opportunity that has linked
applications.

The companion mocked suite (`test_grant_service.py`) cannot exercise this at
all — the bug this guards against lives entirely in how SQLAlchemy's
unit-of-work interprets the `GrantOpportunity.applications` relationship's
cascade configuration, which a mocked session has no opinion on. Before the
fix, that relationship carried `cascade="all, delete-orphan"` while
`GrantApplication.opportunity_id` is declared `ondelete="SET NULL"` — the
opposite of what the FK says. Deleting an opportunity with linked
applications either crashed (an implicit async lazy-load of `applications`)
or silently deleted every linked application, along with its budget items,
expenditures, compliance tasks, and notes.

Runs against a real database and asserts on what is still there afterwards.
"""

import uuid

import pytest
from sqlalchemy import select

from app.models.grant import GrantApplication, GrantOpportunity
from app.models.user import Organization
from app.services.grant_service import GrantService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Grants FD"):
    org = Organization(name=name, slug=f"grants-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def test_deleting_an_opportunity_orphans_its_application_rather_than_deleting_it(
    db_session,
):
    org = await _make_org(db_session)
    opportunity = GrantOpportunity(organization_id=org.id, name="AFG Equipment Grant")
    db_session.add(opportunity)
    await db_session.flush()

    application = GrantApplication(
        organization_id=org.id,
        opportunity_id=opportunity.id,
        grant_program_name="AFG Equipment Grant",
    )
    db_session.add(application)
    await db_session.flush()
    application_id = application.id

    service = GrantService(db_session)
    deleted = await service.delete_opportunity(opportunity.id, org.id)
    assert deleted is True

    # The DB's own ON DELETE SET NULL fired as part of that flush, but the
    # `application` object in this session's identity map still holds the
    # value it was loaded with — expire it so the SELECT below re-reads the
    # actual row rather than returning the stale cached instance.
    db_session.expire_all()

    result = await db_session.execute(
        select(GrantApplication).where(GrantApplication.id == application_id)
    )
    surviving = result.scalar_one_or_none()

    assert surviving is not None, (
        "the linked application must survive the opportunity's deletion — "
        "opportunity_id is ondelete='SET NULL', not a cascade-delete"
    )
    assert surviving.opportunity_id is None
