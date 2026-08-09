"""
FIN2-1 (app-review B20 pass 3): applies_to / step_type / approver_type /
frequency / expense_type / mapping_type / priority on the finance request
schemas map to strict MySQL ENUM columns but were typed as free str and stored
raw — an out-of-set value 500'd at MySQL. Request schemas now validate the enum
INPUT (the B1 latent-500 class); money amounts are untouched. DB-free.
"""

import pytest
from pydantic import ValidationError

from app.schemas.finance import (
    ApprovalChainStepCreate,
    ApprovalChainStepUpdate,
    ExportMappingCreate,
    PurchaseRequestUpdate,
)


class TestApprovalStepEnumValidation:
    def test_valid_and_case_normalized(self):
        s = ApprovalChainStepCreate(
            step_order=1, name="Approve", step_type="APPROVAL", approver_type="Email"
        )
        assert s.step_type == "approval"
        assert s.approver_type == "email"

    def test_rejects_bad_step_type(self):
        with pytest.raises(ValidationError) as exc:
            ApprovalChainStepCreate(
                step_order=1, name="A", step_type="bogus", approver_type="position"
            )
        assert any(e["loc"][0] == "step_type" for e in exc.value.errors())

    def test_rejects_bad_approver_type(self):
        with pytest.raises(ValidationError) as exc:
            ApprovalChainStepCreate(
                step_order=1, name="A", step_type="approval", approver_type="wizard"
            )
        assert any(e["loc"][0] == "approver_type" for e in exc.value.errors())

    def test_update_allows_omitted(self):
        u = ApprovalChainStepUpdate(name="Renamed")
        assert u.step_type is None and u.approver_type is None


class TestOtherFinanceEnums:
    def test_priority_rejects_unknown(self):
        with pytest.raises(ValidationError) as exc:
            PurchaseRequestUpdate(priority="whenever")
        assert any(e["loc"][0] == "priority" for e in exc.value.errors())

    def test_priority_accepts_valid(self):
        assert PurchaseRequestUpdate(priority="urgent").priority == "urgent"

    def test_mapping_type_rejects_unknown(self):
        with pytest.raises(ValidationError) as exc:
            ExportMappingCreate(
                internal_category="Dues",
                qb_account_name="Income:Dues",
                mapping_type="liability",
            )
        assert any(e["loc"][0] == "mapping_type" for e in exc.value.errors())

    def test_mapping_type_accepts_valid(self):
        m = ExportMappingCreate(
            internal_category="Dues",
            qb_account_name="Income:Dues",
            mapping_type="income",
        )
        assert m.mapping_type == "income"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
