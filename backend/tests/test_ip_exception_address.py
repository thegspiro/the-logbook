"""An IP exception request names one real address, stored as the server
compares it; the admin lists name the member each exception is for.

Workflow review W74: "999.1.1.1" and "not-an-ip" were accepted and queued
for approval. An exception is matched by exact comparison with a request's
client address, so neither could ever have worked once approved. And the
admin queue listed addresses with no member beside them.
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.ip_security import get_pending_exceptions
from app.models.user import Organization, User
from app.services.ip_security_service import IPSecurityService

pytestmark = pytest.mark.integration


async def _member(db: AsyncSession):
    org = Organization(
        id=str(uuid.uuid4()),
        name="IP VFD",
        slug=f"ip-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    name = f"member-{uuid.uuid4().hex[:8]}"
    user = User(
        organization_id=org.id,
        username=name,
        first_name="Jordan",
        last_name="Avery",
        email=f"{name}@example.com",
    )
    db.add(user)
    await db.flush()
    return org, user


async def _request(db, org, user, address):
    return await IPSecurityService().request_ip_exception(
        db=db,
        user_id=user.id,
        organization_id=org.id,
        ip_address=address,
        reason="At a conference",
        requested_duration_days=7,
        use_case="travel",
    )


@pytest.mark.parametrize("address", ["999.1.1.1", "not-an-ip", "203.0.113.0/24", ""])
async def test_anything_but_one_address_is_refused(db_session, address):
    org, user = await _member(db_session)
    with pytest.raises(ValueError, match="single IPv4 or IPv6 address"):
        await _request(db_session, org, user, address)


@pytest.mark.parametrize(
    ("typed", "stored"),
    [(" 203.0.113.50 ", "203.0.113.50"), ("2001:DB8:0:0::1", "2001:db8::1")],
)
async def test_the_address_is_stored_as_it_is_compared(db_session, typed, stored):
    org, user = await _member(db_session)
    exception = await _request(db_session, org, user, typed)
    assert exception.ip_address == stored


async def test_the_pending_queue_names_the_member(db_session):
    org, user = await _member(db_session)
    await _request(db_session, org, user, "203.0.113.50")

    rows = await get_pending_exceptions(
        limit=50, offset=0, db=db_session, current_user=user
    )

    assert [r.user_name for r in rows] == ["Jordan Avery"]
