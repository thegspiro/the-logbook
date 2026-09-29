"""
Wire contract for the IP-security request schemas.

The request schemas are snake_case with no alias generator — only the response
schemas serialize camelCase — so the frontend service maps its camelCase types
to snake_case before posting. These tests pin both halves of that contract: the
snake_case body the service sends validates, and the camelCase body it used to
send does not (it 422'd the member request form and silently dropped approval
overrides).
"""

import pytest
from pydantic import ValidationError

from app.schemas.ip_security import (
    CountryBlockRuleCreate,
    IPExceptionApprove,
    IPExceptionReject,
    IPExceptionRequestCreate,
    IPExceptionRevoke,
)

pytestmark = pytest.mark.unit


def test_exception_request_accepts_snake_case_body():
    data = IPExceptionRequestCreate.model_validate(
        {
            "ip_address": "203.0.113.50",
            "reason": "Conference travel",
            "requested_duration_days": 7,
            "use_case": "travel",
            "description": "Hotel wifi",
        }
    )
    assert data.ip_address == "203.0.113.50"
    assert data.requested_duration_days == 7
    assert data.use_case == "travel"


def test_exception_request_rejects_camel_case_body():
    with pytest.raises(ValidationError):
        IPExceptionRequestCreate.model_validate(
            {
                "ipAddress": "203.0.113.50",
                "reason": "Conference travel",
                "requestedDurationDays": 7,
                "useCase": "travel",
            }
        )


def test_approve_reads_snake_case_overrides():
    data = IPExceptionApprove.model_validate(
        {"approved_duration_days": 14, "approval_notes": "OK for trip"}
    )
    assert data.approved_duration_days == 14
    assert data.approval_notes == "OK for trip"


def test_approve_ignores_camel_case_overrides():
    # The failure mode that made approve look like it worked: no 422, the
    # override is simply never read.
    data = IPExceptionApprove.model_validate(
        {"approvedDurationDays": 14, "approvalNotes": "OK for trip"}
    )
    assert data.approved_duration_days is None
    assert data.approval_notes is None


def test_reject_and_revoke_accept_snake_case_reasons():
    assert (
        IPExceptionReject.model_validate(
            {"rejection_reason": "not justified"}
        ).rejection_reason
        == "not justified"
    )
    assert (
        IPExceptionRevoke.model_validate({"revoke_reason": "member left"}).revoke_reason
        == "member left"
    )


def test_country_block_rule_accepts_snake_case_body():
    data = CountryBlockRuleCreate.model_validate(
        {
            "country_code": "KP",
            "country_name": "North Korea",
            "reason": "Sanctioned",
            "risk_level": "critical",
        }
    )
    assert data.country_code == "KP"
    assert data.country_name == "North Korea"
    assert data.risk_level == "critical"
