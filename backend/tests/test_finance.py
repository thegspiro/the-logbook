"""
Finance Module Tests

Tests for fiscal years, budgets, purchase requests, expense reports,
check requests, dues, and approval chains.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    DuesSchedule,
    DuesStatus,
    ExpenseLineItem,
    ExpenseReport,
    ExpenseReportStatus,
    FiscalYear,
    FiscalYearStatus,
    MemberDues,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.services.finance_service import FinanceService


# ============================================
# Fiscal Year Tests
# ============================================


class TestFiscalYearService:
    """Tests for fiscal year CRUD operations"""

    async def test_create_fiscal_year(self, db_session: AsyncSession, sample_org_data):
        """Test creating a fiscal year"""
        service = FinanceService(db_session)
        fy = await service.create_fiscal_year(
            org_id=sample_org_data["id"],
            created_by=sample_org_data.get("admin_id", "test-user-id"),
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        assert fy.name == "FY2026"
        assert fy.status == FiscalYearStatus.DRAFT
        assert fy.is_locked is False

    async def test_activate_fiscal_year(self, db_session: AsyncSession, sample_org_data):
        """Test activating a fiscal year"""
        service = FinanceService(db_session)
        fy = await service.create_fiscal_year(
            org_id=sample_org_data["id"],
            created_by=sample_org_data.get("admin_id", "test-user-id"),
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        activated = await service.activate_fiscal_year(fy.id, sample_org_data["id"])
        assert activated.status == FiscalYearStatus.ACTIVE

    async def test_lock_fiscal_year(self, db_session: AsyncSession, sample_org_data):
        """Test locking a fiscal year"""
        service = FinanceService(db_session)
        fy = await service.create_fiscal_year(
            org_id=sample_org_data["id"],
            created_by=sample_org_data.get("admin_id", "test-user-id"),
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        locked = await service.lock_fiscal_year(fy.id, sample_org_data["id"])
        assert locked.is_locked is True
        assert locked.status == FiscalYearStatus.CLOSED

    async def test_cannot_update_locked_fiscal_year(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that locked fiscal years cannot be modified"""
        service = FinanceService(db_session)
        fy = await service.create_fiscal_year(
            org_id=sample_org_data["id"],
            created_by=sample_org_data.get("admin_id", "test-user-id"),
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        await service.lock_fiscal_year(fy.id, sample_org_data["id"])

        with pytest.raises(ValueError, match="locked"):
            await service.update_fiscal_year(
                fy.id, sample_org_data["id"], name="Updated"
            )

    async def test_only_one_active_fiscal_year(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that activating a FY deactivates the current one"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy1 = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2025",
            start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2025, 12, 31, tzinfo=timezone.utc),
        )
        fy2 = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        await service.activate_fiscal_year(fy1.id, org_id)
        await service.activate_fiscal_year(fy2.id, org_id)

        refreshed_fy1 = await service.get_fiscal_year(fy1.id, org_id)
        assert refreshed_fy1.status == FiscalYearStatus.CLOSED

        refreshed_fy2 = await service.get_fiscal_year(fy2.id, org_id)
        assert refreshed_fy2.status == FiscalYearStatus.ACTIVE


# ============================================
# Budget Tests
# ============================================


class TestBudgetService:
    """Tests for budget CRUD and calculations"""

    async def test_create_budget_category(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test creating a budget category"""
        service = FinanceService(db_session)
        cat = await service.create_budget_category(
            org_id=sample_org_data["id"],
            name="Training",
            description="Training expenses",
        )
        assert cat.name == "Training"
        assert cat.is_active is True

    async def test_create_budget(self, db_session: AsyncSession, sample_org_data):
        """Test creating a budget line"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        cat = await service.create_budget_category(
            org_id=org_id, name="Training"
        )
        budget = await service.create_budget(
            org_id=org_id,
            created_by=user_id,
            fiscal_year_id=fy.id,
            category_id=cat.id,
            amount_budgeted=50000.00,
        )

        assert float(budget.amount_budgeted) == 50000.00
        assert float(budget.amount_spent) == 0
        assert float(budget.amount_encumbered) == 0

    async def test_budget_summary(self, db_session: AsyncSession, sample_org_data):
        """Test budget summary calculation"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        cat = await service.create_budget_category(
            org_id=org_id, name="Training"
        )
        await service.create_budget(
            org_id=org_id,
            created_by=user_id,
            fiscal_year_id=fy.id,
            category_id=cat.id,
            amount_budgeted=50000.00,
        )

        summary = await service.get_budget_summary(org_id, fy.id)
        assert summary["total_budgeted"] == 50000.00
        assert summary["total_spent"] == 0
        assert summary["total_remaining"] == 50000.00
        assert summary["percent_used"] == 0


# ============================================
# Approval Chain Tests
# ============================================


class TestApprovalChainService:
    """Tests for approval chain configuration and execution"""

    async def test_create_approval_chain_with_steps(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test creating a chain with steps"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        chain = await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Training Purchase Approval",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            min_amount=1000,
            is_default=False,
            steps=[
                {
                    "step_order": 1,
                    "name": "Training Officer Review",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.POSITION,
                    "approver_value": "training_officer",
                },
                {
                    "step_order": 2,
                    "name": "Board of Trustees",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.POSITION,
                    "approver_value": "trustee",
                },
                {
                    "step_order": 3,
                    "name": "Email Confirmation",
                    "step_type": ApprovalStepType.NOTIFICATION,
                    "approver_type": ApproverType.EMAIL,
                    "approver_value": "treasurer@dept.org",
                },
            ],
        )

        assert chain.name == "Training Purchase Approval"
        assert len(chain.steps) == 3
        assert chain.steps[0].name == "Training Officer Review"
        assert chain.steps[2].step_type == ApprovalStepType.NOTIFICATION

    async def test_chain_resolution_by_amount(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that chain resolution picks the correct chain by amount"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        # Create small purchase chain
        await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Small Purchase",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            min_amount=0,
            max_amount=500,
            is_default=False,
            steps=[
                {
                    "step_order": 1,
                    "name": "Officer Review",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                },
            ],
        )

        # Create large purchase chain
        await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Large Purchase",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            min_amount=500,
            is_default=False,
            steps=[
                {
                    "step_order": 1,
                    "name": "Officer Review",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                },
                {
                    "step_order": 2,
                    "name": "Treasurer Approval",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.POSITION,
                    "approver_value": "treasurer",
                },
            ],
        )

        small_chain = await service.resolve_approval_chain(
            org_id, ApprovalEntityType.PURCHASE_REQUEST, 300
        )
        assert small_chain is not None
        assert small_chain.name == "Small Purchase"

        large_chain = await service.resolve_approval_chain(
            org_id, ApprovalEntityType.PURCHASE_REQUEST, 5000
        )
        assert large_chain is not None
        assert large_chain.name == "Large Purchase"

    async def test_approval_step_progression(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test approving steps in sequence"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        chain = await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Two-Step Approval",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Step 1",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                },
                {
                    "step_order": 2,
                    "name": "Step 2",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                },
            ],
        )

        # Create approval records
        records = await service.create_approval_records(
            chain,
            ApprovalEntityType.PURCHASE_REQUEST,
            "test-entity-id",
            1000.00,
            user_id,
        )
        assert len(records) == 2
        assert records[0].status == ApprovalStepStatus.PENDING
        assert records[1].status == ApprovalStepStatus.PENDING

        # Approve step 1
        current = await service.get_current_pending_step(
            ApprovalEntityType.PURCHASE_REQUEST, "test-entity-id"
        )
        assert current is not None
        assert current.id == records[0].id

        await service.approve_step(records[0].id, user_id, "Looks good")

        # Check step 2 is now current
        current2 = await service.get_current_pending_step(
            ApprovalEntityType.PURCHASE_REQUEST, "test-entity-id"
        )
        assert current2 is not None
        assert current2.id == records[1].id

    async def test_notification_step_auto_advances(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that notification steps auto-advance after prior steps complete"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        chain = await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Approve then Notify",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Approve",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                },
                {
                    "step_order": 2,
                    "name": "Notify Treasurer",
                    "step_type": ApprovalStepType.NOTIFICATION,
                    "approver_type": ApproverType.EMAIL,
                    "approver_value": "treasurer@dept.org",
                },
            ],
        )

        records = await service.create_approval_records(
            chain,
            ApprovalEntityType.PURCHASE_REQUEST,
            "test-notify-entity",
            500.00,
            user_id,
        )

        # Approve step 1 → notification step should auto-advance
        await service.approve_step(records[0].id, user_id)

        updated_records = await service.get_approval_records(
            ApprovalEntityType.PURCHASE_REQUEST, "test-notify-entity"
        )
        notification_record = next(
            (r for r in updated_records if r.step_id == records[1].step_id), None
        )
        assert notification_record is not None
        assert notification_record.status == ApprovalStepStatus.SENT

    async def test_auto_approve_under_threshold(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test auto-approve when amount is under step threshold"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        chain = await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Auto-Approve Small",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Auto if under $100",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                    "auto_approve_under": 100.00,
                },
            ],
        )

        records = await service.create_approval_records(
            chain,
            ApprovalEntityType.PURCHASE_REQUEST,
            "test-auto-approve",
            50.00,
            user_id,
        )

        assert records[0].status == ApprovalStepStatus.AUTO_APPROVED

    async def test_deny_step(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test denying an approval step"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        chain = await service.create_approval_chain(
            org_id=org_id,
            created_by=user_id,
            name="Simple Approval",
            applies_to=ApprovalEntityType.PURCHASE_REQUEST,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Review",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.PERMISSION,
                    "approver_value": "finance.approve",
                },
            ],
        )

        records = await service.create_approval_records(
            chain,
            ApprovalEntityType.PURCHASE_REQUEST,
            "test-deny-entity",
            1000.00,
            user_id,
        )

        denied = await service.deny_step(
            records[0].id, user_id, "Budget exceeded"
        )
        assert denied.status == ApprovalStepStatus.DENIED
        assert denied.notes == "Budget exceeded"


# ============================================
# Purchase Request Tests
# ============================================


class TestPurchaseRequestService:
    """Tests for purchase request workflows"""

    async def test_create_purchase_request(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test creating a purchase request"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        pr = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fy.id,
            title="New SCBA Equipment",
            vendor="MSA Safety",
            estimated_amount=15000.00,
        )

        assert pr.title == "New SCBA Equipment"
        assert pr.request_number.startswith("PR-2026-")
        assert pr.status == PurchaseRequestStatus.DRAFT

    async def test_auto_number_increments(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that request numbers auto-increment"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        pr1 = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fy.id,
            title="Request 1",
            estimated_amount=100.00,
        )
        pr2 = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fy.id,
            title="Request 2",
            estimated_amount=200.00,
        )

        assert pr1.request_number == "PR-2026-0001"
        assert pr2.request_number == "PR-2026-0002"

    async def test_submit_purchase_request(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test submitting a purchase request transitions status"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        pr = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fy.id,
            title="Test PR",
            estimated_amount=1000.00,
        )

        submitted = await service.submit_purchase_request(pr.id, org_id)
        assert submitted.status == PurchaseRequestStatus.PENDING_APPROVAL

    async def test_cannot_submit_non_draft(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that only draft requests can be submitted"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        pr = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fy.id,
            title="Test PR",
            estimated_amount=1000.00,
        )

        await service.submit_purchase_request(pr.id, org_id)

        with pytest.raises(ValueError, match="Only draft"):
            await service.submit_purchase_request(pr.id, org_id)

    async def test_pr_status_flow(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test the full purchase request status flow"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )
        cat = await service.create_budget_category(
            org_id=org_id, name="Equipment"
        )
        budget = await service.create_budget(
            org_id=org_id,
            created_by=user_id,
            fiscal_year_id=fy.id,
            category_id=cat.id,
            amount_budgeted=100000.00,
        )

        pr = await service.create_purchase_request(
            org_id=org_id,
            requested_by=user_id,
            fiscal_year_id=fy.id,
            budget_id=budget.id,
            title="Engine Parts",
            estimated_amount=5000.00,
        )

        # Submit → Approve manually (no chain configured)
        submitted = await service.submit_purchase_request(pr.id, org_id)
        assert submitted.status == PurchaseRequestStatus.PENDING_APPROVAL

        # Mark ordered (need to set approved first)
        submitted.status = PurchaseRequestStatus.APPROVED
        await db_session.flush()

        ordered = await service.mark_pr_ordered(pr.id, org_id)
        assert ordered.status == PurchaseRequestStatus.ORDERED

        received = await service.mark_pr_received(pr.id, org_id)
        assert received.status == PurchaseRequestStatus.RECEIVED

        paid = await service.mark_pr_paid(pr.id, org_id, actual_amount=4800.00)
        assert paid.status == PurchaseRequestStatus.PAID
        assert float(paid.actual_amount) == 4800.00


# ============================================
# Expense Report Tests
# ============================================


class TestExpenseReportService:
    """Tests for expense report workflows"""

    async def test_create_expense_report_with_items(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test creating an expense report with line items"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        er = await service.create_expense_report(
            org_id=org_id,
            submitted_by=user_id,
            fiscal_year_id=fy.id,
            title="March Training Expenses",
            line_items=[
                {
                    "description": "Conference registration",
                    "amount": 250.00,
                    "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
                    "expense_type": "conference",
                },
                {
                    "description": "Hotel",
                    "amount": 450.00,
                    "date_incurred": datetime(2026, 3, 1, tzinfo=timezone.utc),
                    "expense_type": "travel",
                },
            ],
        )

        assert er.title == "March Training Expenses"
        assert er.report_number.startswith("ER-2026-")
        assert float(er.total_amount) == 700.00

    async def test_submit_empty_expense_report_fails(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that empty expense reports cannot be submitted"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        fy = await service.create_fiscal_year(
            org_id=org_id,
            created_by=user_id,
            name="FY2026",
            start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_date=datetime(2026, 12, 31, tzinfo=timezone.utc),
        )

        er = await service.create_expense_report(
            org_id=org_id,
            submitted_by=user_id,
            fiscal_year_id=fy.id,
            title="Empty Report",
        )

        with pytest.raises(ValueError, match="line items"):
            await service.submit_expense_report(er.id, org_id)


# ============================================
# Dues Tests
# ============================================


class TestDuesService:
    """Tests for dues management"""

    async def test_create_dues_schedule(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test creating a dues schedule"""
        service = FinanceService(db_session)
        org_id = sample_org_data["id"]
        user_id = sample_org_data.get("admin_id", "test-user-id")

        schedule = await service.create_dues_schedule(
            org_id=org_id,
            created_by=user_id,
            name="2026 Annual Dues",
            amount=250.00,
            frequency="annual",
            due_date=datetime(2026, 3, 1, tzinfo=timezone.utc),
        )

        assert schedule.name == "2026 Annual Dues"
        assert float(schedule.amount) == 250.00

    async def test_dues_summary_empty(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test dues summary with no data"""
        service = FinanceService(db_session)
        summary = await service.get_dues_summary(sample_org_data["id"])
        assert summary["total_expected"] == 0
        assert summary["collection_rate"] == 0


# ============================================
# Dashboard Tests
# ============================================


class TestDashboardService:
    """Tests for the finance dashboard"""

    async def test_dashboard_returns_data(
        self, db_session: AsyncSession, sample_org_data
    ):
        """Test that dashboard returns structured data"""
        service = FinanceService(db_session)
        dashboard = await service.get_dashboard(sample_org_data["id"])

        assert "budget_health" in dashboard
        assert "pending_approvals_count" in dashboard
        assert "pending_purchase_requests" in dashboard
        assert "dues_collection_rate" in dashboard
        assert dashboard["pending_approvals_count"] == 0
