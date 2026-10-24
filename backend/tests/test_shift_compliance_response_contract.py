"""The compliance report keeps the catch-up deadline the service computes.

``get_shift_compliance`` puts ``catch_up_deadline`` on each member row and
leaves a member inside a catch-up period out of the header counts, but
``MemberComplianceRecord`` did not declare the field, so the endpoint's
response model dropped it and the screen showed that member as non-compliant.
"""

import pytest

from app.api.v1.endpoints.scheduling import router

pytestmark = pytest.mark.unit


def _compliance_response_model():
    for route in router.routes:
        if getattr(route, "path", None) == "/reports/compliance" and "GET" in getattr(
            route, "methods", set()
        ):
            return route.response_model
    raise AssertionError("GET /reports/compliance is not registered")


def _member(**overrides):
    # The row exactly as get_shift_compliance builds it.
    row = {
        "user_id": "u1",
        "first_name": "Pat",
        "last_name": "Doe",
        "full_name": "Pat Doe",
        "rank": None,
        "completed_value": 2.0,
        "required_value": 6.0,
        "leave_months": 0,
        "percentage": 33.3,
        "compliant": False,
        "shift_count": 2,
        "total_hours": 24.0,
        "external_shift_count": 0,
        "external_hours": 0.0,
        "catch_up_deadline": None,
    }
    row.update(overrides)
    return row


def _payload(member):
    return {
        "requirements": [
            {
                "requirement_id": "r1",
                "requirement_name": "Shifts",
                "requirement_type": "shifts",
                "required_value": 6.0,
                "frequency": "annual",
                "period_start": "2026-01-01",
                "period_end": "2026-12-31",
                "members": [member],
                "total_members": 0,
                "compliant_count": 0,
                "non_compliant_count": 0,
                "compliance_rate": 0,
            }
        ],
        "reference_date": "2026-10-24",
        "total_requirements": 1,
    }


def test_a_catch_up_deadline_reaches_the_response():
    model = _compliance_response_model()
    dumped = model.model_validate(
        _payload(_member(catch_up_deadline="2027-01-31"))
    ).model_dump()

    member = dumped["requirements"][0]["members"][0]
    assert member["catch_up_deadline"] == "2027-01-31"


def test_a_member_with_no_catch_up_period_reads_null():
    model = _compliance_response_model()
    dumped = model.model_validate(_payload(_member())).model_dump()

    assert dumped["requirements"][0]["members"][0]["catch_up_deadline"] is None
