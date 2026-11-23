"""
A member's admin-hours targets come from the profile that grades them.

Owner decision 2026-11-23. ``get_user_hours_compliance`` used to choose the
highest-priority matching profile that carried admin hours, matching profiles
by rules of its own that lacked grading's "junior" chip handling. A junior
member graded under a "junior" profile therefore took admin-hours targets
from whatever lower profile matched their legacy membership type, and sat
under two profiles at once (CLAUDE.md pitfall 29).

Now one resolver, ``training_compliance.admin_hours_profile``, takes the
profile ``ComplianceGrading.for_member`` grades the member by (same tie-break,
same junior handling). When that profile sets no admin hours, it falls back to
the rule that held before: the highest-priority matching profile that does.
"""

import uuid
from datetime import datetime

import pytest

from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.user import User, UserStatus
from app.services.admin_hours_service import AdminHoursService
from tests.test_admin_hours_compliance_lookup import _category, _org

pytestmark = [pytest.mark.integration]


async def _member(db_session, org, **fields) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@gradingprofile.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        **fields,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _config(db_session, org) -> ComplianceConfig:
    config = ComplianceConfig(id=str(uuid.uuid4()), organization_id=org.id)
    db_session.add(config)
    await db_session.flush()
    return config


async def _profile(
    db_session, config, category, *, name, priority, types, admin_hours
) -> ComplianceProfile:
    profile = ComplianceProfile(
        id=str(uuid.uuid4()),
        config_id=config.id,
        name=name,
        membership_types=types,
        is_active=True,
        priority=priority,
        admin_hours_requirements=(
            [
                {
                    "category_id": category.id,
                    "required_hours": admin_hours,
                    "frequency": "annual",
                }
            ]
            if admin_hours is not None
            else None
        ),
    )
    db_session.add(profile)
    await db_session.flush()
    return profile


async def _targets(db_session, org, user_id) -> list[float]:
    db_session.expunge_all()
    results = await AdminHoursService(db_session).get_user_hours_compliance(
        organization_id=org.id, user_id=user_id, year=datetime.now().year
    )
    return [r["required_hours"] for r in results]


async def test_a_junior_member_takes_targets_from_the_junior_profile(db_session):
    """Grading matches the "junior" chip on the member's status; the old
    admin-hours lookup read only the legacy membership type, which a junior
    member carries as "probationary", and picked the probationary profile."""
    org = await _org(db_session)
    category = await _category(db_session, org)
    config = await _config(db_session, org)
    await _profile(
        db_session,
        config,
        category,
        name="Juniors",
        priority=20,
        types=["junior"],
        admin_hours=10,
    )
    await _profile(
        db_session,
        config,
        category,
        name="Probationary",
        priority=10,
        types=["probationary"],
        admin_hours=5,
    )
    user = await _member(
        db_session, org, membership_type="probationary", member_status="junior"
    )

    assert await _targets(db_session, org, user.id) == [10]


async def test_a_grading_profile_without_admin_hours_falls_back(db_session):
    """The member is graded by "Everyone", which sets no admin hours, so the
    targets come from the highest-priority matching profile that does."""
    org = await _org(db_session)
    category = await _category(db_session, org)
    config = await _config(db_session, org)
    await _profile(
        db_session,
        config,
        category,
        name="Everyone",
        priority=30,
        types=[],
        admin_hours=None,
    )
    await _profile(
        db_session,
        config,
        category,
        name="Active, higher",
        priority=20,
        types=["active"],
        admin_hours=8,
    )
    await _profile(
        db_session,
        config,
        category,
        name="Active, lower",
        priority=10,
        types=["active"],
        admin_hours=3,
    )
    user = await _member(db_session, org, membership_type="active")

    assert await _targets(db_session, org, user.id) == [8]


async def test_a_profile_the_member_does_not_match_is_never_used(db_session):
    org = await _org(db_session)
    category = await _category(db_session, org)
    config = await _config(db_session, org)
    await _profile(
        db_session,
        config,
        category,
        name="Juniors",
        priority=20,
        types=["junior"],
        admin_hours=10,
    )
    user = await _member(db_session, org, membership_type="active")

    assert await _targets(db_session, org, user.id) == []
