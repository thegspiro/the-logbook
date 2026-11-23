"""Regression coverage for raw attendance grading in shift compliance."""

from datetime import date

import pytest

from tests.test_external_shift_hours import _add_org, _add_user
from tests.test_shift_compliance_hours_shared_grader import _hours_req, _row, _shift

pytestmark = [pytest.mark.integration]


async def test_hours_compliance_uses_raw_minutes_before_display_rounding(db_session):
    # 53 minutes shows as 1.0 hour at quarter-hour precision, but is short of
    # a one-hour target: rounding must not erase the shortfall.
    org_id = await _add_org(db_session)
    user_id = await _add_user(db_session, org_id)
    await _hours_req(db_session, org_id, 1)
    await _shift(db_session, org_id, user_id, date(2025, 8, 25), 53)

    member = await _row(db_session, org_id)

    assert member["completed_value"] == 1.0
    assert member["total_hours"] == 1.0
    assert member["compliant"] is False
