"""Money fields on the grants and fundraising request schemas (GF-9).

Every amount used to be ``ge=0`` with no ceiling, so a $0 donation and a
$999,999,999 one both saved and flowed into every total and report. A gift (a
donation or a pledge) now has to be more than $0 and at most $1,000,000;
awards, budgets and goals are capped at $100,000,000. The bounds are on the
request schemas only, so a row written before them still serializes.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas import grant as g

pytestmark = pytest.mark.unit

GIFT_MAX = Decimal("1000000")
BIG_MAX = Decimal("100000000")

REQUIRED = {
    "GrantOpportunityCreate": {"name": "AFG"},
    "GrantApplicationCreate": {},
    "GrantBudgetItemCreate": {"category": "equipment"},
    "GrantExpenditureCreate": {
        "description": "Radios",
        "expenditure_date": date(2026, 9, 1),
    },
    "CampaignCreate": {
        "name": "Hose drive",
        "campaign_type": "general",
        "start_date": date(2026, 9, 1),
    },
    "DonationCreate": {
        "donation_date": datetime(2026, 9, 1, tzinfo=timezone.utc),
        "payment_method": "check",
    },
    "PledgeCreate": {"pledge_date": date(2026, 9, 1)},
    "FundraisingEventCreate": {
        "name": "Gala",
        "event_type": "gala",
        "event_date": datetime(2026, 9, 1, tzinfo=timezone.utc),
    },
}

# (schema, field, minimum allowed, ceiling) — one row per money field a client
# can write. ``minimum`` is Decimal("0") where $0 means something (a denied
# grant's award, a free ticket) and a positive number where it cannot.
REQUEST_FIELDS = [
    ("GrantOpportunityCreate", "typical_award_min", Decimal("0"), BIG_MAX),
    ("GrantOpportunityCreate", "typical_award_max", Decimal("0"), BIG_MAX),
    ("GrantApplicationCreate", "amount_requested", Decimal("0"), BIG_MAX),
    ("GrantApplicationCreate", "amount_awarded", Decimal("0"), BIG_MAX),
    ("GrantApplicationCreate", "match_amount", Decimal("0"), BIG_MAX),
    ("GrantBudgetItemCreate", "amount_budgeted", Decimal("0"), BIG_MAX),
    ("GrantBudgetItemCreate", "federal_share", Decimal("0"), BIG_MAX),
    ("GrantBudgetItemCreate", "local_match", Decimal("0"), BIG_MAX),
    ("GrantExpenditureCreate", "amount", Decimal("0"), BIG_MAX),
    ("CampaignCreate", "goal_amount", Decimal("0"), BIG_MAX),
    ("CampaignCreate", "minimum_donation", Decimal("0"), GIFT_MAX),
    ("DonationCreate", "amount", Decimal("0.01"), GIFT_MAX),
    ("PledgeCreate", "pledged_amount", Decimal("0.01"), GIFT_MAX),
    ("FundraisingEventCreate", "ticket_price", Decimal("0"), GIFT_MAX),
    ("FundraisingEventCreate", "revenue_goal", Decimal("0"), BIG_MAX),
    ("GrantOpportunityUpdate", "typical_award_min", Decimal("0"), BIG_MAX),
    ("GrantOpportunityUpdate", "typical_award_max", Decimal("0"), BIG_MAX),
    ("GrantApplicationUpdate", "amount_requested", Decimal("0"), BIG_MAX),
    ("GrantApplicationUpdate", "amount_awarded", Decimal("0"), BIG_MAX),
    ("GrantApplicationUpdate", "match_amount", Decimal("0"), BIG_MAX),
    ("GrantBudgetItemUpdate", "amount_budgeted", Decimal("0"), BIG_MAX),
    ("GrantBudgetItemUpdate", "federal_share", Decimal("0"), BIG_MAX),
    ("GrantBudgetItemUpdate", "local_match", Decimal("0"), BIG_MAX),
    ("GrantExpenditureUpdate", "amount", Decimal("0"), BIG_MAX),
    ("CampaignUpdate", "goal_amount", Decimal("0"), BIG_MAX),
    ("CampaignUpdate", "minimum_donation", Decimal("0"), GIFT_MAX),
    ("DonationUpdate", "amount", Decimal("0.01"), GIFT_MAX),
    ("PledgeUpdate", "pledged_amount", Decimal("0.01"), GIFT_MAX),
    ("PledgeUpdate", "fulfilled_amount", Decimal("0"), GIFT_MAX),
    ("FundraisingEventUpdate", "ticket_price", Decimal("0"), GIFT_MAX),
    ("FundraisingEventUpdate", "revenue_goal", Decimal("0"), BIG_MAX),
    ("FundraisingEventUpdate", "actual_revenue", Decimal("0"), BIG_MAX),
    ("FundraisingEventUpdate", "expenses", Decimal("0"), BIG_MAX),
]
IDS = [f"{schema}.{field}" for schema, field, _, _ in REQUEST_FIELDS]


def _build(schema: str, field: str, value: Decimal):
    cls = getattr(g, schema)
    payload = {
        k: v
        for k, v in {
            **REQUIRED.get(schema, {}),
            # A required money field is supplied below; give the others a value
            # so the schema is otherwise valid.
            "amount_budgeted": Decimal("1"),
            "amount": Decimal("1"),
            "goal_amount": Decimal("1"),
            "pledged_amount": Decimal("1"),
        }.items()
        if k in cls.model_fields
    }
    payload[field] = value
    return cls(**payload)


@pytest.mark.parametrize(
    ("schema", "field", "minimum", "ceiling"), REQUEST_FIELDS, ids=IDS
)
class TestEveryRequestMoneyField:
    def test_the_ceiling_itself_is_accepted(self, schema, field, minimum, ceiling):
        assert getattr(_build(schema, field, ceiling), field) == ceiling

    def test_a_cent_over_the_ceiling_is_refused(self, schema, field, minimum, ceiling):
        with pytest.raises(ValidationError):
            _build(schema, field, ceiling + Decimal("0.01"))

    def test_the_smallest_allowed_amount_is_accepted(
        self, schema, field, minimum, ceiling
    ):
        assert getattr(_build(schema, field, minimum), field) == minimum

    def test_a_negative_amount_is_refused(self, schema, field, minimum, ceiling):
        with pytest.raises(ValidationError):
            _build(schema, field, Decimal("-0.01"))


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        ("DonationCreate", "amount"),
        ("PledgeCreate", "pledged_amount"),
        ("DonationUpdate", "amount"),
        ("PledgeUpdate", "pledged_amount"),
    ],
)
def test_a_gift_of_nothing_is_refused(schema, field):
    with pytest.raises(ValidationError):
        _build(schema, field, Decimal("0"))


@pytest.mark.parametrize(
    ("schema", "field"),
    [
        ("GrantApplicationCreate", "amount_awarded"),
        ("FundraisingEventCreate", "ticket_price"),
    ],
)
def test_zero_is_still_valid_where_it_means_something(schema, field):
    assert getattr(_build(schema, field, Decimal("0")), field) == 0


class TestBudgetSummaryCategories:
    def test_a_category_over_the_ceiling_is_refused(self):
        with pytest.raises(ValidationError):
            g.GrantBudgetSummary(equipment=float(BIG_MAX) + 1)

    def test_a_category_at_the_ceiling_is_accepted(self):
        assert g.GrantBudgetSummary(equipment=float(BIG_MAX)).equipment == float(
            BIG_MAX
        )


class TestResponsesStillReadOldRows:
    """A row saved before the ceilings must still serialize, or its list 500s."""

    def test_a_zero_dollar_donation_reads_back(self):
        row = {
            "id": uuid.uuid4(),
            "organization_id": uuid.uuid4(),
            "amount": Decimal("0"),
            "donation_date": datetime(2026, 9, 1, tzinfo=timezone.utc),
            "payment_method": "check",
            "payment_status": "completed",
            "is_recurring": False,
            "is_anonymous": False,
            "created_at": datetime(2026, 9, 1, tzinfo=timezone.utc),
            "updated_at": datetime(2026, 9, 1, tzinfo=timezone.utc),
        }

        assert g.DonationResponse.model_validate(row).amount == 0

    def test_a_pledge_over_the_gift_ceiling_reads_back(self):
        row = {
            "id": uuid.uuid4(),
            "organization_id": uuid.uuid4(),
            "pledged_amount": GIFT_MAX * 5,
            "fulfilled_amount": Decimal("0"),
            "pledge_date": date(2026, 9, 1),
            "status": "pending",
            "reminder_enabled": True,
            "created_at": datetime(2026, 9, 1, tzinfo=timezone.utc),
            "updated_at": datetime(2026, 9, 1, tzinfo=timezone.utc),
        }

        assert g.PledgeResponse.model_validate(row).pledged_amount == GIFT_MAX * 5
