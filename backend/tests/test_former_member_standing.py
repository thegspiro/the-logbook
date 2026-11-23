"""
A former member is not graded on the profile card or the officer's view.

The compliance matrix lists only current members (``ACTIVE_ACCOUNT_STATUSES``,
CLAUDE.md pitfall 32), but the profile card
(``GET /training/compliance-summary/{user_id}``) and the training officer's
member view (``GET /training/module-config/members/{user_id}/requirements``)
graded anyone in the department. A member who had left read green or red on
those two screens with no matrix row to agree with (pitfall 29). Both now
report a "not a current member" standing instead of a grade.
"""

from uuid import UUID

import pytest

from app.api.v1.endpoints.training import get_compliance_summary
from app.api.v1.endpoints.training_module_config import get_member_requirements
from app.models.user import User, UserStatus
from tests.test_profile_card_standing import (
    _config,
    _hours_reqs,
    _load,
    _meet,
    _member,
    _org,
    _rows,
)

pytestmark = [pytest.mark.integration]

FORMER_STATUSES = [
    UserStatus.INACTIVE,
    UserStatus.RETIRED,
    UserStatus.DROPPED_VOLUNTARY,
    UserStatus.ARCHIVED,
]


async def _former_member_meeting_everything(db, status: UserStatus):
    org, today = await _org(db)
    await _config(db, org)
    await _hours_reqs(db, org, 2)
    user = await _member(db, org, "Former")
    await _meet(db, org, user, 2, today)
    user.status = status
    await db.flush()
    return org, await _load(db, user.id)


@pytest.mark.parametrize("status", FORMER_STATUSES)
async def test_the_profile_card_does_not_grade_a_former_member(db_session, status):
    org, user = await _former_member_meeting_everything(db_session, status)

    # The matrix has no row for them, so no colour on the card can agree.
    assert user.id not in await _rows(db_session, org)

    caller = User(id=user.id, organization_id=org.id)
    card = await get_compliance_summary(
        user_id=UUID(user.id), db=db_session, current_user=caller
    )

    assert card.compliance_status == "not_current_member"
    assert card.compliance_label == "Not a Current Member"
    assert (card.requirements_met, card.requirements_total) == (0, 0)


@pytest.mark.parametrize("status", FORMER_STATUSES)
async def test_the_officer_view_does_not_grade_a_former_member(db_session, status):
    org, user = await _former_member_meeting_everything(db_session, status)

    view = await get_member_requirements(
        user_id=user.id,
        db=db_session,
        current_user=User(id=user.id, organization_id=org.id),
    )

    assert view["standing"] == "not_current_member"
    assert view["standing_label"] == "Not a Current Member"
    assert view["requirements_detail"] == []
    assert view["optional_requirements_detail"] == []
    assert view["requirements_summary"] == {
        "total_requirements": 0,
        "met_requirements": 0,
        "avg_compliance": None,
    }


@pytest.mark.parametrize("status", [UserStatus.ACTIVE, UserStatus.PROBATIONARY])
async def test_a_current_member_is_still_graded_on_both(db_session, status):
    org, today = await _org(db_session)
    await _config(db_session, org)
    await _hours_reqs(db_session, org, 2)
    user = await _member(db_session, org, "Current")
    await _meet(db_session, org, user, 2, today)
    user.status = status
    await db_session.flush()
    user = await _load(db_session, user.id)

    caller = User(id=user.id, organization_id=org.id)
    card = await get_compliance_summary(
        user_id=UUID(user.id), db=db_session, current_user=caller
    )
    view = await get_member_requirements(
        user_id=user.id, db=db_session, current_user=caller
    )

    assert (card.compliance_status, card.compliance_label) == ("green", "Compliant")
    assert (card.requirements_met, card.requirements_total) == (2, 2)
    assert view["standing"] is None
    assert view["standing_label"] is None
    assert view["requirements_summary"]["met_requirements"] == 2
