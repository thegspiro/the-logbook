"""
``GET /users/directory`` — the roster a member without ``members.manage`` gets
(USR-8).

The Members page showed such a member a reduced "Member Directory" while the
``GET /users`` response behind it still carried every field the directory hid
— username, hire date, station, platoon. The directory endpoint serves only
what the directory shows, so the boundary the screen implies is the one the
wire enforces. ``GET /users`` and its other callers are unchanged.
"""

import uuid
from datetime import date

import pytest

from app.api.v1.endpoints.users import list_member_directory
from app.models.user import Organization, User, UserStatus

pytestmark = [pytest.mark.integration]

HIDDEN_FROM_DIRECTORY = {
    "username",
    "hire_date",
    "station",
    "platoon",
    "membership_type",
    "member_class",
    "member_status",
    "compliance_exempt",
    "organization_id",
}


async def _org(db_session, *, show_email=True) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Directory Department",
        slug=f"directory-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={
            "contact_info_visibility": {
                "enabled": True,
                "show_email": show_email,
                "show_phone": True,
                "show_mobile": False,
            }
        },
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, **overrides) -> User:
    handle = uuid.uuid4().hex[:10]
    fields = dict(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{handle}",
        email=f"{handle}@directory.test",
        first_name="Dana",
        last_name=f"Member-{handle}",
        password_hash="x",
        status=UserStatus.ACTIVE,
        hire_date=date(2019, 4, 1),
        rank="captain",
        station="Station 2",
        platoon="B",
        phone="703-555-0101",
        mobile="703-555-0199",
        membership_number=handle[:6],
    )
    fields.update(overrides)
    user = User(**fields)
    db_session.add(user)
    await db_session.flush()
    return user


async def test_directory_carries_only_what_the_directory_shows(db_session):
    org = await _org(db_session)
    caller = await _member(db_session, org)
    colleague = await _member(db_session, org)

    rows = await list_member_directory(db=db_session, current_user=caller)

    row = next(r for r in rows if str(r.id) == colleague.id)
    payload = row.model_dump()
    assert HIDDEN_FROM_DIRECTORY.isdisjoint(payload)
    assert payload["rank"] == "captain"
    assert payload["membership_number"] == colleague.membership_number
    assert payload["status"] == "active"
    # Contact fields follow the department's ceiling: email and phone shown,
    # mobile not.
    assert payload["email"] == colleague.email
    assert payload["phone"] == "703-555-0101"
    assert payload["mobile"] is None


async def test_the_member_own_choice_hides_a_field(db_session):
    org = await _org(db_session)
    caller = await _member(db_session, org)
    private = await _member(
        db_session,
        org,
        profile_visibility={"email": False, "phone": True, "mobile": True},
    )

    rows = await list_member_directory(db=db_session, current_user=caller)

    row = next(r for r in rows if str(r.id) == private.id)
    assert row.email is None
    assert row.phone == "703-555-0101"


async def test_department_ceiling_off_hides_contact_details(db_session):
    org = await _org(db_session, show_email=False)
    caller = await _member(db_session, org)

    rows = await list_member_directory(db=db_session, current_user=caller)

    assert all(r.email is None for r in rows)


async def test_archived_members_are_not_listed(db_session):
    """W15-4: former members are not in an ordinary member's directory."""
    org = await _org(db_session)
    caller = await _member(db_session, org)
    departed = await _member(db_session, org, status=UserStatus.ARCHIVED)
    on_leave = await _member(db_session, org, status=UserStatus.LEAVE)

    rows = await list_member_directory(db=db_session, current_user=caller)

    ids = {str(r.id) for r in rows}
    assert departed.id not in ids
    assert on_leave.id in ids


async def test_directory_is_org_scoped(db_session):
    org = await _org(db_session)
    other = await _org(db_session)
    caller = await _member(db_session, org)
    outsider = await _member(db_session, other)

    rows = await list_member_directory(db=db_session, current_user=caller)

    ids = {str(r.id) for r in rows}
    assert caller.id in ids
    assert outsider.id not in ids
