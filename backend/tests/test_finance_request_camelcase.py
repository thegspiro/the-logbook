"""
Finance request bodies are accepted in camelCase as well as snake_case.

The Finance pages build their request bodies from the camelCase response
types (``startDate``, ``fiscalYearId``, ``estimatedAmount`` ...), but the
request schemas carried no alias, so a create came back 422 for "missing"
required fields and an update silently dropped every multi-word key — clearing
a purchase request's ``budgetId`` acknowledged the save and left the budget
attached. The request schemas now take either spelling; these tests pin that
for every request schema, and pin that the snake_case callers (the approval
chain page, the public token approval page) keep working unchanged.
"""

import warnings
from datetime import datetime, timezone

import pytest
from pydantic import BaseModel, ValidationError
from pydantic.alias_generators import to_camel

from app.models.finance import ExpenseType
from app.schemas import finance as finance_schemas
from app.schemas.finance import (
    ApprovalActionRequest,
    ApprovalChainCreate,
    ApprovalChainStepCreate,
    ApprovalChainStepUpdate,
    ApprovalChainUpdate,
    BudgetAmendmentCreate,
    BudgetCategoryCreate,
    BudgetCategoryUpdate,
    BudgetCreate,
    BudgetRequestCreate,
    BudgetRequestDecision,
    BudgetRequestUpdate,
    BudgetUpdate,
    CheckRequestCreate,
    CheckRequestUpdate,
    DuesScheduleCreate,
    DuesScheduleUpdate,
    ExpenseLineItemCreate,
    ExpenseReportCreate,
    ExpenseReportUpdate,
    ExportMappingCreate,
    ExportMappingUpdate,
    ExportRequest,
    FiscalYearCreate,
    FiscalYearUpdate,
    ManualDenyRequest,
    MemberDuesPayment,
    MemberDuesUnwaive,
    MemberDuesWaive,
    PurchaseRequestCreate,
    PurchaseRequestUpdate,
)

_STEP = {
    "step_order": 1,
    "name": "Chief sign-off",
    "step_type": "approval",
    "approver_type": "position",
    "approver_value": "fire_chief",
    "notification_emails": ["chief@example.com"],
    "email_template_id": "tmpl-1",
    "allow_self_approval": True,
    "auto_approve_under": "25.00",
    "required": False,
}

_LINE_ITEM = {
    "budget_id": "budget-1",
    "description": "Gloves",
    "amount": "42.50",
    "date_incurred": "2026-03-01T00:00:00Z",
    "expense_type": "meals",
    "receipt_url": "https://example.com/r.pdf",
    "merchant": "Supply Co",
}

# One snake_case body per request schema, giving every multi-word field a
# non-default value — a dropped camelCase key then shows up as a difference
# in the dump rather than hiding behind the field's default.
SNAKE_BODIES: dict[type[BaseModel], dict] = {
    FiscalYearCreate: {
        "name": "FY2026",
        "start_date": "2026-01-01T00:00:00Z",
        "end_date": "2026-12-31T00:00:00Z",
    },
    FiscalYearUpdate: {
        "name": "FY2026b",
        "start_date": "2026-01-02T00:00:00Z",
        "end_date": "2026-12-30T00:00:00Z",
        "request_deadline": "2026-11-15",
    },
    BudgetCategoryCreate: {
        "name": "Apparatus",
        "description": "Trucks",
        "parent_category_id": "cat-parent",
        "sort_order": 3,
        "qb_account_name": "6100 Apparatus",
        "owner_position_id": "pos-1",
    },
    BudgetCategoryUpdate: {
        "name": "Apparatus",
        "description": "Trucks",
        "parent_category_id": "cat-parent",
        "sort_order": 4,
        "is_active": False,
        "qb_account_name": "6100 Apparatus",
        "owner_position_id": "pos-1",
    },
    BudgetCreate: {
        "fiscal_year_id": "fy-1",
        "category_id": "cat-1",
        "amount_budgeted": "1000.00",
        "notes": "n",
        "station_id": "st-1",
        "owner_position_id": "pos-1",
    },
    BudgetUpdate: {
        "amount_budgeted": "900.00",
        "notes": "n",
        "station_id": "st-2",
        "owner_position_id": "pos-2",
    },
    BudgetAmendmentCreate: {
        "amount": "250.00",
        "reason": "Hose replacement",
        "approved_by": "Board vote 10/7",
        "approved_on": "2026-10-07",
    },
    BudgetRequestCreate: {
        "fiscal_year_id": "fy-2",
        "budget_id": "budget-1",
        "category_id": "cat-1",
        "station_id": "st-1",
        "owner_position_id": "pos-1",
        "requested_amount": "2400.00",
        "justification": "Two more academy seats",
    },
    BudgetRequestUpdate: {
        "requested_amount": "2500.00",
        "justification": "Three seats",
    },
    BudgetRequestDecision: {
        "decision": "adjust",
        "approved_amount": "2000.00",
        "decision_note": "Hold at this year's level",
    },
    ApprovalChainStepCreate: dict(_STEP),
    ApprovalChainStepUpdate: dict(_STEP),
    ApprovalChainCreate: {
        "name": "Large purchases",
        "description": "Over 500",
        "applies_to": "purchase_request",
        "min_amount": "500.00",
        "max_amount": "5000.00",
        "budget_category_id": "cat-1",
        "is_default": True,
        "steps": [dict(_STEP)],
    },
    ApprovalChainUpdate: {
        "name": "Large purchases",
        "description": "Over 500",
        "applies_to": "purchase_request",
        "min_amount": "500.00",
        "max_amount": "5000.00",
        "budget_category_id": "cat-1",
        "is_default": True,
        "is_active": False,
    },
    ApprovalActionRequest: {"notes": "Looks fine"},
    ManualDenyRequest: {"reason": "No budget left this quarter"},
    PurchaseRequestCreate: {
        "fiscal_year_id": "fy-1",
        "budget_id": "budget-1",
        "title": "Hose",
        "description": "d",
        "vendor": "v",
        "estimated_amount": "250.00",
        "priority": "high",
        "notes": "n",
        "apparatus_id": "app-1",
        "facility_id": "fac-1",
    },
    PurchaseRequestUpdate: {
        "budget_id": "budget-1",
        "title": "Hose",
        "description": "d",
        "vendor": "v",
        "estimated_amount": "250.00",
        "actual_amount": "240.00",
        "priority": "low",
        "notes": "n",
        "receipt_url": "https://example.com/r.pdf",
        "apparatus_id": "app-1",
    },
    ExpenseLineItemCreate: dict(_LINE_ITEM),
    ExpenseReportCreate: {
        "fiscal_year_id": "fy-1",
        "title": "Conference",
        "description": "d",
        "notes": "n",
        "line_items": [dict(_LINE_ITEM)],
    },
    ExpenseReportUpdate: {"title": "Conference", "description": "d", "notes": "n"},
    CheckRequestCreate: {
        "fiscal_year_id": "fy-1",
        "budget_id": "budget-1",
        "payee_name": "Vendor Inc",
        "payee_address": "1 Main St",
        "amount": "99.99",
        "memo": "m",
        "purpose": "p",
        "notes": "n",
    },
    CheckRequestUpdate: {
        "budget_id": "budget-1",
        "payee_name": "Vendor Inc",
        "payee_address": "1 Main St",
        "amount": "99.99",
        "memo": "m",
        "purpose": "p",
        "notes": "n",
        "check_number": "1001",
        "check_date": "2026-04-01T00:00:00Z",
    },
    DuesScheduleCreate: {
        "name": "Annual",
        "amount": "50.00",
        "frequency": "annual",
        "due_date": "2026-06-01T00:00:00Z",
        "grace_period_days": 10,
        "late_fee_amount": "5.00",
        "fiscal_year_id": "fy-1",
        "applies_to_membership_types": ["active"],
        "notes": "n",
    },
    DuesScheduleUpdate: {
        "name": "Annual",
        "amount": "50.00",
        "frequency": "annual",
        "due_date": "2026-06-01T00:00:00Z",
        "grace_period_days": 10,
        "late_fee_amount": "5.00",
        "fiscal_year_id": "fy-1",
        "applies_to_membership_types": ["active"],
        "is_active": False,
        "notes": "n",
    },
    MemberDuesPayment: {
        "amount_paid": "50.00",
        "payment_method": "check",
        "transaction_reference": "chk-1001",
        "notes": "n",
    },
    MemberDuesWaive: {"reason": "Hardship"},
    MemberDuesUnwaive: {"reason": "Entered in error"},
    ExportMappingCreate: {
        "internal_category": "Apparatus",
        "qb_account_name": "6100 Apparatus",
        "qb_account_number": "6100",
        "qb_offset_account_name": "1000 Operating Checking",
        "mapping_type": "expense",
    },
    ExportMappingUpdate: {
        "internal_category": "Apparatus",
        "qb_account_name": "6100 Apparatus",
        "qb_account_number": "6100",
        "qb_offset_account_name": "1000 Operating Checking",
        "mapping_type": "expense",
    },
    ExportRequest: {
        "date_range_start": "2026-01-01T00:00:00Z",
        "date_range_end": "2026-02-01T00:00:00Z",
        "file_format": "csv",
    },
}

REQUEST_SCHEMAS = list(SNAKE_BODIES)


def _camelize(value):
    if isinstance(value, dict):
        return {to_camel(k): _camelize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_camelize(v) for v in value]
    return value


@pytest.mark.unit
class TestEveryRequestSchemaTakesCamelCase:
    @pytest.mark.parametrize("schema", REQUEST_SCHEMAS, ids=lambda s: s.__name__)
    def test_camel_and_snake_bodies_validate_identically(self, schema):
        snake = SNAKE_BODIES[schema]
        from_snake = schema.model_validate(snake)
        from_camel = schema.model_validate(_camelize(snake))

        assert from_camel.model_dump() == from_snake.model_dump()
        assert from_camel.model_fields_set == from_snake.model_fields_set
        # Every key in the body landed on a field; none was ignored as extra.
        assert from_snake.model_fields_set == set(snake)

    @pytest.mark.parametrize("schema", REQUEST_SCHEMAS, ids=lambda s: s.__name__)
    def test_dump_keys_stay_snake_case_for_the_service_layer(self, schema):
        dumped = schema.model_validate(_camelize(SNAKE_BODIES[schema])).model_dump()
        assert set(dumped) == set(schema.model_fields)

    @pytest.mark.parametrize("schema", REQUEST_SCHEMAS, ids=lambda s: s.__name__)
    def test_validation_errors_still_name_the_snake_case_field(self, schema):
        # loc_by_alias=False: 422 field names are what they were before the
        # alias was added, so nothing reading them changes.
        assert schema.model_config.get("loc_by_alias") is False

    def test_every_request_schema_in_the_module_is_covered(self):
        # A request schema added later without the config would reintroduce
        # the bug for its own endpoint; this makes it fail here instead.
        request_models = {
            obj
            for obj in vars(finance_schemas).values()
            if isinstance(obj, type)
            and issubclass(obj, BaseModel)
            and obj.__module__ == finance_schemas.__name__
            and not obj.__name__.endswith("Response")
        }
        assert request_models == set(REQUEST_SCHEMAS)


@pytest.mark.unit
class TestUpdateSemanticsSurviveTheAlias:
    """Omitted means leave alone; explicit null means clear (CLAUDE.md #1)."""

    def test_camelcase_explicit_null_is_kept_under_exclude_unset(self):
        dumped = PurchaseRequestUpdate.model_validate({"budgetId": None}).model_dump(
            exclude_unset=True
        )
        assert dumped == {"budget_id": None}

    def test_snake_case_explicit_null_is_kept_under_exclude_unset(self):
        dumped = PurchaseRequestUpdate.model_validate({"budget_id": None}).model_dump(
            exclude_unset=True
        )
        assert dumped == {"budget_id": None}

    def test_omitted_key_is_absent_under_exclude_unset(self):
        dumped = PurchaseRequestUpdate.model_validate({"title": "Hose"}).model_dump(
            exclude_unset=True
        )
        assert dumped == {"title": "Hose"}
        assert "budget_id" not in dumped

    @pytest.mark.parametrize(
        ("schema", "camel_key", "field"),
        [
            (CheckRequestUpdate, "payeeAddress", "payee_address"),
            (DuesScheduleUpdate, "lateFeeAmount", "late_fee_amount"),
            (ApprovalChainStepUpdate, "approverType", "approver_type"),
            (ExportMappingUpdate, "qbAccountNumber", "qb_account_number"),
            (BudgetCategoryUpdate, "parentCategoryId", "parent_category_id"),
            (BudgetCategoryUpdate, "ownerPositionId", "owner_position_id"),
            (BudgetUpdate, "ownerPositionId", "owner_position_id"),
            (BudgetUpdate, "stationId", "station_id"),
            (FiscalYearUpdate, "requestDeadline", "request_deadline"),
        ],
    )
    def test_camelcase_null_clears_across_update_schemas(
        self, schema, camel_key, field
    ):
        dumped = schema.model_validate({camel_key: None}).model_dump(exclude_unset=True)
        assert dumped == {field: None}


@pytest.mark.unit
class TestValidatorsSeeCamelCaseInput:
    def test_enum_validator_runs_on_a_camelcase_key(self):
        with pytest.raises(ValidationError) as exc:
            ApprovalChainStepCreate.model_validate(
                {"stepOrder": 1, "name": "x", "approverType": "nobody"}
            )
        assert any(e["loc"] == ("approver_type",) for e in exc.value.errors())

    def test_enum_validator_normalizes_a_camelcase_value(self):
        step = ApprovalChainStepCreate.model_validate(
            {"stepOrder": 1, "name": "x", "stepType": "NOTIFICATION"}
        )
        assert step.step_type == "notification"

    def test_export_range_validator_runs_on_camelcase_keys(self):
        with pytest.raises(ValidationError, match="on or after"):
            ExportRequest.model_validate(
                {
                    "dateRangeStart": "2026-02-01T00:00:00Z",
                    "dateRangeEnd": "2026-01-01T00:00:00Z",
                }
            )

    def test_export_naive_datetime_is_normalized_from_camelcase(self):
        req = ExportRequest.model_validate(
            {
                "dateRangeStart": "2026-01-01T00:00:00",
                "dateRangeEnd": "2026-01-02T00:00:00Z",
            }
        )
        assert req.date_range_start == datetime(2026, 1, 1, tzinfo=timezone.utc)

    def test_missing_required_field_is_reported_by_field_name(self):
        with pytest.raises(ValidationError) as exc:
            FiscalYearCreate.model_validate({"name": "FY"})
        locs = {e["loc"] for e in exc.value.errors()}
        assert locs == {("start_date",), ("end_date",)}

    def test_expense_type_is_normalized_to_the_enum_without_a_dump_warning(self):
        item = ExpenseLineItemCreate.model_validate(
            {
                "description": "Lunch",
                "amount": "12.00",
                "dateIncurred": "2026-03-01T00:00:00Z",
                "expenseType": "MEALS",
            }
        )
        assert item.expense_type is ExpenseType.MEALS
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            item.model_dump()

    def test_unknown_expense_type_is_still_a_validation_error(self):
        with pytest.raises(ValidationError, match="Invalid expense_type"):
            ExpenseLineItemCreate.model_validate(
                {
                    "description": "Lunch",
                    "amount": "12.00",
                    "dateIncurred": "2026-03-01T00:00:00Z",
                    "expenseType": "supplies",
                }
            )
