"""
Approval-chain / budget-category / chain-step FK validation
(CLAUDE.md pitfall 14c).

``_validate_finance_fks`` was fixed for ``station_id`` (see
``test_finance_station_fk_validation.py``) but the same file carries four
more client-supplied, ``ondelete="SET NULL"`` foreign keys that were never
validated at all: ``PurchaseRequest.apparatus_id``/``facility_id`` (checked
via the same shared helper, since ``create_purchase_request``/
``update_purchase_request`` already call it), ``BudgetCategory.
parent_category_id`` (self-referential), ``ApprovalChain.budget_category_id``,
and ``ApprovalChainStep.email_template_id``. All four are cross-org dangling
references: the *other* org deleting the referenced row silently nulls this
org's field, and — for the chain fields — a client that names another org's
budget category or email template as a target with no ownership check on
either side.

DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.finance_service import FinanceService


def _found(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class TestPurchaseRequestApparatusFacilityScoping:
    async def test_rejects_an_apparatus_from_another_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        with pytest.raises(ValueError, match="Invalid Apparatus"):
            await svc._validate_finance_fks("org-1", {"apparatus_id": "app-FOREIGN"})

    async def test_rejects_a_facility_from_another_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        with pytest.raises(ValueError, match="Invalid Facility"):
            await svc._validate_finance_fks("org-1", {"facility_id": "fac-FOREIGN"})

    async def test_accepts_an_apparatus_and_facility_in_the_callers_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found("in-org"))
        svc = FinanceService(db)

        await svc._validate_finance_fks(
            "org-1", {"apparatus_id": "app-1", "facility_id": "fac-1"}
        )

    async def test_absent_apparatus_and_facility_are_not_rejected(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        await svc._validate_finance_fks("org-1", {})
        await svc._validate_finance_fks(
            "org-1", {"apparatus_id": None, "facility_id": None}
        )


class TestBudgetCategoryParentScoping:
    async def test_rejects_a_parent_category_from_another_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        with pytest.raises(ValueError, match="Invalid Parent category"):
            await svc._validate_budget_category_fks(
                "org-1", {"parent_category_id": "cat-FOREIGN"}
            )

    async def test_accepts_a_parent_category_in_the_callers_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found("cat-1"))
        svc = FinanceService(db)

        await svc._validate_budget_category_fks(
            "org-1", {"parent_category_id": "cat-1"}
        )

    async def test_an_absent_parent_category_is_not_rejected(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        await svc._validate_budget_category_fks("org-1", {})
        await svc._validate_budget_category_fks("org-1", {"parent_category_id": None})


class TestApprovalChainBudgetCategoryScoping:
    async def test_rejects_a_budget_category_from_another_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        with pytest.raises(ValueError, match="Invalid Budget category"):
            await svc._validate_approval_chain_fks(
                "org-1", {"budget_category_id": "cat-FOREIGN"}
            )

    async def test_accepts_a_budget_category_in_the_callers_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found("cat-1"))
        svc = FinanceService(db)

        await svc._validate_approval_chain_fks("org-1", {"budget_category_id": "cat-1"})

    async def test_an_absent_budget_category_is_not_rejected(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        await svc._validate_approval_chain_fks("org-1", {})
        await svc._validate_approval_chain_fks("org-1", {"budget_category_id": None})


class TestChainStepEmailTemplateScoping:
    async def test_rejects_an_email_template_from_another_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        with pytest.raises(ValueError, match="Invalid Email template"):
            await svc._validate_chain_step_fks(
                "org-1", {"email_template_id": "tmpl-FOREIGN"}
            )

    async def test_accepts_an_email_template_in_the_callers_org(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found("tmpl-1"))
        svc = FinanceService(db)

        await svc._validate_chain_step_fks("org-1", {"email_template_id": "tmpl-1"})

    async def test_an_absent_email_template_is_not_rejected(self):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_found(None))
        svc = FinanceService(db)

        await svc._validate_chain_step_fks("org-1", {})
        await svc._validate_chain_step_fks("org-1", {"email_template_id": None})
