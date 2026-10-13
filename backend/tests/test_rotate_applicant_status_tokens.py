"""
Tests for scripts/rotate_applicant_status_tokens.py (W17-3).

The owner chose rotation per department, on request: it revokes the tokens
printed on applicant labels before W17-3, at the cost of every status link
already emailed to that department. So the script must touch one department
only, must make the old token stop resolving, and must write nothing on a dry
run.
"""

import importlib.util
import pathlib
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.membership_pipeline_service import MembershipPipelineService

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "rotate_applicant_status_tokens.py"
)
_spec = importlib.util.spec_from_file_location("_rotate_status_tokens", _SCRIPT)
rotate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rotate)

pytestmark = pytest.mark.integration


async def _second_org(db: AsyncSession) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": f"Other Dept {org_id[:8]}", "slug": f"od-{org_id[:8]}"},
    )
    return org_id


async def _applicant(db, org_id, admin_id, email):
    svc = MembershipPipelineService(db)
    pipeline = await svc.create_pipeline(organization_id=org_id, name=f"P {email}")
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "App",
            "last_name": "Licant",
            "email": email,
            "pipeline_id": pipeline.id,
        },
        created_by=admin_id,
    )
    return prospect


async def _hash_of(db, prospect_id) -> str:
    return (
        await db.execute(
            text("SELECT status_token_hash FROM prospective_members WHERE id = :id"),
            {"id": prospect_id},
        )
    ).scalar_one()


async def test_dry_run_writes_nothing_and_apply_rotates_only_that_department(
    db_session: AsyncSession, setup_org_and_admin
):
    org_id, admin_id = setup_org_and_admin
    other_org = await _second_org(db_session)
    mine = await _applicant(db_session, org_id, admin_id, "w173-a@example.com")
    theirs = await _applicant(db_session, other_org, admin_id, "w173-b@example.com")
    await db_session.flush()
    old_token = mine.status_token
    old_hash = await _hash_of(db_session, mine.id)
    their_hash = await _hash_of(db_session, theirs.id)

    org = await rotate.resolve_org(db_session, org_id)
    planned = await rotate.plan(db_session, org)
    assert [p.id for p in planned] == [mine.id]
    assert await _hash_of(db_session, mine.id) == old_hash

    assert await rotate.apply(db_session, org, planned) == 1

    assert mine.status_token != old_token
    assert await _hash_of(db_session, mine.id) != old_hash
    assert await _hash_of(db_session, theirs.id) == their_hash
    # The old link no longer opens anything.
    svc = MembershipPipelineService(db_session)
    assert await svc.get_prospect_by_token(old_token) is None


async def test_the_org_must_be_named_exactly(
    db_session: AsyncSession, setup_org_and_admin
):
    org_id, _ = setup_org_and_admin
    with pytest.raises(rotate.OrgNotFound):
        await rotate.resolve_org(db_session, "no such department anywhere")
    name = (
        await db_session.execute(
            text("SELECT name FROM organizations WHERE id = :id"), {"id": org_id}
        )
    ).scalar_one()
    # A substring is not enough: rotating the wrong department breaks links.
    with pytest.raises(rotate.OrgNotFound):
        await rotate.resolve_org(db_session, name[:-2])
    assert (await rotate.resolve_org(db_session, name.upper())).id == org_id


async def test_nothing_to_rotate_writes_nothing(
    db_session: AsyncSession, setup_org_and_admin
):
    org_id, _ = setup_org_and_admin
    org = await rotate.resolve_org(db_session, org_id)
    assert await rotate.apply(db_session, org, []) == 0
