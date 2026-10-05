"""External-training user mappings name the linked member by their legal name.

The mapping screen reconciles a vendor's roster (Vector Solutions et al.)
against members, and those rosters carry legal names. The lookup previously
selected ``User.full_name`` — a Python property, not a column — so listing any
provider with a linked member raised before returning a row.
"""

import uuid

import pytest

from app.api.v1.endpoints.external_training import list_user_mappings
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingProvider,
    ExternalUserMapping,
)
from app.models.user import Organization, User, UserStatus

pytestmark = [pytest.mark.integration]


async def test_linked_member_is_named_by_legal_name(db_session):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Mapping Test Department",
        slug=f"mapping-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"theather-{uuid.uuid4().hex[:6]}",
        email=f"{uuid.uuid4().hex[:8]}@mapping.test",
        first_name="John",
        last_name="Heather",
        preferred_name="Terry",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Vector",
        provider_type=list(ExternalProviderType)[0],
    )
    db_session.add_all([member, provider])
    await db_session.flush()
    db_session.add(
        ExternalUserMapping(
            id=str(uuid.uuid4()),
            provider_id=provider.id,
            organization_id=org.id,
            external_user_id="vs-1",
            external_name="John Heather",
            internal_user_id=member.id,
            is_mapped=True,
        )
    )
    await db_session.flush()

    rows = await list_user_mappings(uuid.UUID(provider.id), False, db_session, member)

    assert len(rows) == 1
    assert rows[0].internal_user_name == "John Heather"
    assert rows[0].internal_user_email == member.email
