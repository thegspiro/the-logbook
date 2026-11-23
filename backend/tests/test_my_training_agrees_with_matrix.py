"""My Training and the officer's member view agree with the compliance matrix.

The requirement detail behind both member screens used to grade by its own
rules (review finding of 2026-11-21, CLAUDE.md pitfall #29). One of the three
reported disagreements, end to end: an hours requirement whose target is zero.
The matrix leaves it in progress, as the requirement form warns members earn
no credit; My Training called one logged hour enough.
"""

import uuid

import pytest
from sqlalchemy import text

from app.api.v1.endpoints.training_module_config import get_member_requirements
from app.models.user import User
from tests.test_my_training_compliance_profiles import (
    _insert_hours_req,
    _insert_member,
    _insert_org,
    _insert_record,
    _matrix_row,
    _my_training,
)

pytestmark = [pytest.mark.integration]


async def test_a_zero_hour_target_reads_the_same_on_every_screen(db_session):
    org_id = await _insert_org(db_session)
    user_id = await _insert_member(db_session, org_id)
    req_id = await _insert_hours_req(db_session, org_id, name="No Target")
    await db_session.execute(
        text("UPDATE training_requirements SET required_hours = 0 WHERE id = :id"),
        {"id": req_id},
    )
    await _insert_record(db_session, org_id, user_id, hours=2.0)

    row = await _matrix_row(db_session, org_id, user_id)
    own = await _my_training(db_session, user_id)
    view = await get_member_requirements(
        user_id=user_id,
        db=db_session,
        current_user=User(id=str(uuid.uuid4()), organization_id=org_id),
    )

    (cell,) = row["requirements"]
    assert cell["status"] == "in_progress"
    for screen in (own, view):
        (detail,) = screen["requirements_detail"]
        assert detail["is_met"] is False
        summary = screen["requirements_summary"]
        assert (summary["met_requirements"], summary["total_requirements"]) == (
            row["requirements_met"],
            row["requirements_total"],
        )
