"""The applicant drawer names the member who referred a prospect.

``referred_by`` is a user id; the detail response now carries
``referred_by_name`` beside it. Only a referrer in the prospect's own
organization is named — rows written before the FK was validated may point at
another department's member, and that name must not cross over (XC-1).
"""

import uuid

import pytest

from app.models.membership_pipeline import ProspectiveMember
from app.models.user import Organization, User, UserStatus
from app.schemas.membership_pipeline import ProspectResponse
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Referrer Department",
        slug=f"referrer-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, first, last) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"r-{handle}",
        email=f"{handle}@referrer.test",
        first_name=first,
        last_name=last,
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _prospect(db_session, org, referred_by):
    prospect = ProspectiveMember(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        first_name="Casey",
        last_name="Lane",
        email=f"{uuid.uuid4().hex[:8]}@applicant.test",
        referral_source="Attended: Open House",
        interest_reason="Wants to serve.",
        referred_by=referred_by,
    )
    db_session.add(prospect)
    await db_session.flush()
    return prospect


async def test_an_in_org_referrer_is_named(db_session):
    org = await _org(db_session)
    referrer = await _member(db_session, org, "Jordan", "Avery")
    prospect = await _prospect(db_session, org, referrer.id)

    loaded = await MembershipPipelineService(db_session).get_prospect(
        prospect.id, org.id
    )
    body = ProspectResponse.model_validate(loaded).model_dump(mode="json")

    assert body["referred_by_name"] == "Jordan Avery"
    assert body["referral_source"] == "Attended: Open House"
    assert body["interest_reason"] == "Wants to serve."


async def test_another_department_s_member_is_not_named(db_session):
    org = await _org(db_session)
    elsewhere = await _org(db_session)
    outsider = await _member(db_session, elsewhere, "Pat", "Outsider")
    prospect = await _prospect(db_session, org, outsider.id)

    loaded = await MembershipPipelineService(db_session).get_prospect(
        prospect.id, org.id
    )

    assert loaded.referred_by_name is None


async def test_no_referrer_reads_none(db_session):
    org = await _org(db_session)
    prospect = await _prospect(db_session, org, None)

    loaded = await MembershipPipelineService(db_session).get_prospect(
        prospect.id, org.id
    )

    assert loaded.referred_by_name is None
