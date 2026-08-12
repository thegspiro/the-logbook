"""Regression tests for browser-facing grant URLs."""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.grant import (
    CampaignCreate,
    FundraisingEventCreate,
    GrantComplianceTaskCreate,
    GrantExpenditureCreate,
    GrantOpportunityCreate,
)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("application_url", "javascript:alert(1)"),
        ("program_url", "data:text/html,<script>alert(1)</script>"),
        ("application_url", "//example.org/apply"),
        ("program_url", "not a URL"),
    ],
)
def test_opportunity_rejects_non_http_links(field: str, value: str) -> None:
    with pytest.raises(ValidationError, match="absolute HTTP or HTTPS"):
        GrantOpportunityCreate(name="Safety grant", **{field: value})


def test_opportunity_normalizes_external_links() -> None:
    opportunity = GrantOpportunityCreate(
        name="Safety grant",
        application_url="  https://example.org/apply  ",
        program_url="http://example.org/program",
    )

    assert opportunity.application_url == "https://example.org/apply"
    assert opportunity.program_url == "http://example.org/program"


def test_expenditure_rejects_executable_receipt_link() -> None:
    with pytest.raises(ValidationError, match="absolute HTTP or HTTPS"):
        GrantExpenditureCreate(
            description="Equipment",
            amount=Decimal("10.00"),
            expenditure_date=date(2026, 8, 12),
            application_id="00000000-0000-0000-0000-000000000001",
            receipt_url="javascript:alert(1)",
        )


@pytest.mark.parametrize(
    ("schema", "kwargs", "field"),
    [
        (
            GrantComplianceTaskCreate,
            {
                "task_type": "performance_report",
                "title": "Submit report",
                "due_date": date(2026, 9, 1),
                "application_id": "00000000-0000-0000-0000-000000000001",
            },
            "submission_url",
        ),
        (
            CampaignCreate,
            {
                "name": "Fund drive",
                "campaign_type": "general",
                "goal_amount": Decimal("100.00"),
                "start_date": date(2026, 8, 12),
            },
            "hero_image_url",
        ),
        (
            FundraisingEventCreate,
            {
                "name": "Open house",
                "event_type": "other",
                "event_date": "2026-09-01T18:00:00Z",
            },
            "registration_url",
        ),
    ],
)
def test_other_grant_links_reject_executable_urls(schema, kwargs, field) -> None:
    with pytest.raises(ValidationError, match="absolute HTTP or HTTPS"):
        schema(**kwargs, **{field: "javascript:alert(1)"})
