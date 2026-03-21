"""
Finance API Endpoints

Handles fiscal years, budgets, purchase requests, expense reports,
check requests, dues, approval chains, and QuickBooks export.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.finance import (
    ApprovalActionRequest,
    ApprovalChainCreate,
    ApprovalChainResponse,
    ApprovalChainStepCreate,
    ApprovalChainStepResponse,
    ApprovalChainStepUpdate,
    ApprovalChainUpdate,
    ApprovalStepRecordResponse,
    BudgetCategoryCreate,
    BudgetCategoryResponse,
    BudgetCategoryUpdate,
    BudgetCreate,
    BudgetResponse,
    BudgetSummaryResponse,
    BudgetUpdate,
    CheckRequestCreate,
    CheckRequestResponse,
    CheckRequestUpdate,
    DuesScheduleCreate,
    DuesScheduleResponse,
    DuesScheduleUpdate,
    DuesSummaryResponse,
    ExpenseLineItemCreate,
    ExpenseLineItemResponse,
    ExpenseReportCreate,
    ExpenseReportResponse,
    ExpenseReportUpdate,
    ExportLogResponse,
    ExportMappingCreate,
    ExportMappingResponse,
    ExportMappingUpdate,
    ExportRequest,
    FinanceDashboardResponse,
    FiscalYearCreate,
    FiscalYearResponse,
    FiscalYearUpdate,
    MemberDuesPayment,
    MemberDuesResponse,
    MemberDuesWaive,
    PendingApprovalResponse,
    PurchaseRequestCreate,
    PurchaseRequestResponse,
    PurchaseRequestUpdate,
)
from app.services.finance_service import FinanceService

router = APIRouter()


# ============================================
# Fiscal Years
# ============================================


@router.get("/fiscal-years", response_model=list[FiscalYearResponse])
async def list_fiscal_years(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_fiscal_years(str(current_user.organization_id))


@router.post("/fiscal-years", response_model=FiscalYearResponse, status_code=201)
async def create_fiscal_year(
    data: FiscalYearCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        fy = await service.create_fiscal_year(
            org_id=str(current_user.organization_id),
            created_by=str(current_user.id),
            **data.model_dump(),
        )
        await log_audit_event(
            db=db,
            event_type="finance.fiscal_year_created",
            event_category="finance",
            severity="info",
            event_data={"name": data.name},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return fy
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/fiscal-years/{fy_id}", response_model=FiscalYearResponse)
async def get_fiscal_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    fy = await service.get_fiscal_year(fy_id, str(current_user.organization_id))
    if not fy:
        raise HTTPException(status_code=404, detail="Fiscal year not found")
    return fy


@router.put("/fiscal-years/{fy_id}", response_model=FiscalYearResponse)
async def update_fiscal_year(
    fy_id: str,
    data: FiscalYearUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.update_fiscal_year(
            fy_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/fiscal-years/{fy_id}/activate", response_model=FiscalYearResponse)
async def activate_fiscal_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        fy = await service.activate_fiscal_year(
            fy_id, str(current_user.organization_id)
        )
        await log_audit_event(
            db=db,
            event_type="finance.fiscal_year_activated",
            event_category="finance",
            severity="info",
            event_data={"fiscal_year_id": fy_id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return fy
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/fiscal-years/{fy_id}/lock", response_model=FiscalYearResponse)
async def lock_fiscal_year(
    fy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.lock_fiscal_year(fy_id, str(current_user.organization_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Budget Categories
# ============================================


@router.get("/budget-categories", response_model=list[BudgetCategoryResponse])
async def list_budget_categories(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_budget_categories(str(current_user.organization_id))


@router.post(
    "/budget-categories",
    response_model=BudgetCategoryResponse,
    status_code=201,
)
async def create_budget_category(
    data: BudgetCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.create_budget_category(
            str(current_user.organization_id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.put("/budget-categories/{cat_id}", response_model=BudgetCategoryResponse)
async def update_budget_category(
    cat_id: str,
    data: BudgetCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.update_budget_category(
            cat_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.delete("/budget-categories/{cat_id}", status_code=204)
async def delete_budget_category(
    cat_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        await service.delete_budget_category(cat_id, str(current_user.organization_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Budgets
# ============================================


@router.get("/budgets", response_model=list[BudgetResponse])
async def list_budgets(
    fiscal_year_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_budgets(
        str(current_user.organization_id), fiscal_year_id, category_id
    )


@router.post("/budgets", response_model=BudgetResponse, status_code=201)
async def create_budget(
    data: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.create_budget(
            str(current_user.organization_id),
            str(current_user.id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/budgets/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    budget = await service.get_budget(budget_id, str(current_user.organization_id))
    if not budget:
        raise HTTPException(status_code=404, detail="Budget not found")
    return budget


@router.put("/budgets/{budget_id}", response_model=BudgetResponse)
async def update_budget(
    budget_id: str,
    data: BudgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.update_budget(
            budget_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/budgets/summary", response_model=BudgetSummaryResponse)
async def get_budget_summary(
    fiscal_year_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.get_budget_summary(
            str(current_user.organization_id), fiscal_year_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Approval Chains
# ============================================


@router.get("/approval-chains", response_model=list[ApprovalChainResponse])
async def list_approval_chains(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_approval_chains(str(current_user.organization_id))


@router.post(
    "/approval-chains",
    response_model=ApprovalChainResponse,
    status_code=201,
)
async def create_approval_chain(
    data: ApprovalChainCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    service = FinanceService(db)
    try:
        steps_data = None
        if data.steps:
            steps_data = [s.model_dump() for s in data.steps]
        chain_data = data.model_dump(exclude={"steps"})
        chain = await service.create_approval_chain(
            org_id=str(current_user.organization_id),
            created_by=str(current_user.id),
            steps=steps_data,
            **chain_data,
        )
        await log_audit_event(
            db=db,
            event_type="finance.approval_chain_created",
            event_category="finance",
            severity="info",
            event_data={"name": data.name},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return chain
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/approval-chains/{chain_id}", response_model=ApprovalChainResponse)
async def get_approval_chain(
    chain_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    chain = await service.get_approval_chain(
        chain_id, str(current_user.organization_id)
    )
    if not chain:
        raise HTTPException(status_code=404, detail="Approval chain not found")
    return chain


@router.put("/approval-chains/{chain_id}", response_model=ApprovalChainResponse)
async def update_approval_chain(
    chain_id: str,
    data: ApprovalChainUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    service = FinanceService(db)
    try:
        return await service.update_approval_chain(
            chain_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.delete("/approval-chains/{chain_id}", status_code=204)
async def delete_approval_chain(
    chain_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    service = FinanceService(db)
    try:
        await service.delete_approval_chain(chain_id, str(current_user.organization_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/approval-chains/{chain_id}/steps",
    response_model=ApprovalChainStepResponse,
    status_code=201,
)
async def add_chain_step(
    chain_id: str,
    data: ApprovalChainStepCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    service = FinanceService(db)
    try:
        return await service.add_chain_step(
            chain_id,
            str(current_user.organization_id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.put(
    "/approval-chains/{chain_id}/steps/{step_id}",
    response_model=ApprovalChainStepResponse,
)
async def update_chain_step(
    chain_id: str,
    step_id: str,
    data: ApprovalChainStepUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    service = FinanceService(db)
    try:
        return await service.update_chain_step(
            step_id,
            chain_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.delete("/approval-chains/{chain_id}/steps/{step_id}", status_code=204)
async def delete_chain_step(
    chain_id: str,
    step_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    service = FinanceService(db)
    try:
        await service.delete_chain_step(
            step_id, chain_id, str(current_user.organization_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/approval-chains/preview", response_model=ApprovalChainResponse)
async def preview_approval_chain(
    entity_type: str = Query(...),
    amount: float = Query(...),
    category_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        chain = await service.preview_approval_chain(
            str(current_user.organization_id),
            entity_type,
            amount,
            category_id,
        )
        if not chain:
            raise HTTPException(
                status_code=404,
                detail="No matching approval chain found",
            )
        return chain
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Approvals
# ============================================


@router.get("/approvals/pending", response_model=list[PendingApprovalResponse])
async def get_pending_approvals(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    service = FinanceService(db)
    return await service.get_pending_approvals(
        str(current_user.id), str(current_user.organization_id)
    )


@router.post(
    "/approvals/{step_record_id}/approve",
    response_model=ApprovalStepRecordResponse,
)
async def approve_step(
    step_record_id: str,
    data: ApprovalActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    service = FinanceService(db)
    try:
        record = await service.approve_step(
            step_record_id, str(current_user.id), data.notes
        )
        await log_audit_event(
            db=db,
            event_type="finance.approval_step_approved",
            event_category="finance",
            severity="info",
            event_data={"step_record_id": step_record_id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return record
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/approvals/{step_record_id}/deny",
    response_model=ApprovalStepRecordResponse,
)
async def deny_step(
    step_record_id: str,
    data: ApprovalActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    service = FinanceService(db)
    try:
        record = await service.deny_step(
            step_record_id, str(current_user.id), data.notes
        )
        await log_audit_event(
            db=db,
            event_type="finance.approval_step_denied",
            event_category="finance",
            severity="warning",
            event_data={"step_record_id": step_record_id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return record
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Purchase Requests
# ============================================


@router.get("/purchase-requests", response_model=list[PurchaseRequestResponse])
async def list_purchase_requests(
    status: Optional[str] = Query(None),
    fiscal_year_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_purchase_requests(
        str(current_user.organization_id), status, fiscal_year_id
    )


@router.post(
    "/purchase-requests",
    response_model=PurchaseRequestResponse,
    status_code=201,
)
async def create_purchase_request(
    data: PurchaseRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        pr = await service.create_purchase_request(
            str(current_user.organization_id),
            str(current_user.id),
            **data.model_dump(),
        )
        await log_audit_event(
            db=db,
            event_type="finance.purchase_request_created",
            event_category="finance",
            severity="info",
            event_data={
                "request_number": pr.request_number,
                "title": data.title,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return pr
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/purchase-requests/{pr_id}", response_model=PurchaseRequestResponse)
async def get_purchase_request(
    pr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    pr = await service.get_purchase_request(pr_id, str(current_user.organization_id))
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found")
    return pr


@router.put("/purchase-requests/{pr_id}", response_model=PurchaseRequestResponse)
async def update_purchase_request(
    pr_id: str,
    data: PurchaseRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.update_purchase_request(
            pr_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/purchase-requests/{pr_id}/submit",
    response_model=PurchaseRequestResponse,
)
async def submit_purchase_request(
    pr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        pr = await service.submit_purchase_request(
            pr_id, str(current_user.organization_id)
        )
        await log_audit_event(
            db=db,
            event_type="finance.purchase_request_submitted",
            event_category="finance",
            severity="info",
            event_data={"request_number": pr.request_number},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return pr
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/purchase-requests/{pr_id}/mark-ordered",
    response_model=PurchaseRequestResponse,
)
async def mark_pr_ordered(
    pr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.mark_pr_ordered(pr_id, str(current_user.organization_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/purchase-requests/{pr_id}/mark-received",
    response_model=PurchaseRequestResponse,
)
async def mark_pr_received(
    pr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.mark_pr_received(pr_id, str(current_user.organization_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/purchase-requests/{pr_id}/mark-paid",
    response_model=PurchaseRequestResponse,
)
async def mark_pr_paid(
    pr_id: str,
    actual_amount: Optional[float] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.mark_pr_paid(
            pr_id, str(current_user.organization_id), actual_amount
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/purchase-requests/{pr_id}/cancel",
    response_model=PurchaseRequestResponse,
)
async def cancel_purchase_request(
    pr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.cancel_purchase_request(
            pr_id, str(current_user.organization_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Expense Reports
# ============================================


@router.get("/expense-reports", response_model=list[ExpenseReportResponse])
async def list_expense_reports(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_expense_reports(str(current_user.organization_id), status)


@router.post(
    "/expense-reports",
    response_model=ExpenseReportResponse,
    status_code=201,
)
async def create_expense_report(
    data: ExpenseReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        line_items_data = None
        if data.line_items:
            line_items_data = [li.model_dump() for li in data.line_items]
        er_data = data.model_dump(exclude={"line_items"})
        er = await service.create_expense_report(
            str(current_user.organization_id),
            str(current_user.id),
            line_items=line_items_data,
            **er_data,
        )
        return er
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/expense-reports/{er_id}", response_model=ExpenseReportResponse)
async def get_expense_report(
    er_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    er = await service.get_expense_report(er_id, str(current_user.organization_id))
    if not er:
        raise HTTPException(status_code=404, detail="Expense report not found")
    return er


@router.put("/expense-reports/{er_id}", response_model=ExpenseReportResponse)
async def update_expense_report(
    er_id: str,
    data: ExpenseReportUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.update_expense_report(
            er_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/expense-reports/{er_id}/items",
    response_model=ExpenseLineItemResponse,
    status_code=201,
)
async def add_expense_line_item(
    er_id: str,
    data: ExpenseLineItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.add_expense_line_item(
            er_id,
            str(current_user.organization_id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/expense-reports/{er_id}/submit",
    response_model=ExpenseReportResponse,
)
async def submit_expense_report(
    er_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.submit_expense_report(
            er_id, str(current_user.organization_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/expense-reports/{er_id}/mark-paid",
    response_model=ExpenseReportResponse,
)
async def mark_expense_paid(
    er_id: str,
    payment_method: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.mark_expense_paid(
            er_id, str(current_user.organization_id), payment_method
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Check Requests
# ============================================


@router.get("/check-requests", response_model=list[CheckRequestResponse])
async def list_check_requests(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_check_requests(str(current_user.organization_id), status)


@router.post(
    "/check-requests",
    response_model=CheckRequestResponse,
    status_code=201,
)
async def create_check_request(
    data: CheckRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.create_check_request(
            str(current_user.organization_id),
            str(current_user.id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/check-requests/{cr_id}", response_model=CheckRequestResponse)
async def get_check_request(
    cr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    cr = await service.get_check_request(cr_id, str(current_user.organization_id))
    if not cr:
        raise HTTPException(status_code=404, detail="Check request not found")
    return cr


@router.put("/check-requests/{cr_id}", response_model=CheckRequestResponse)
async def update_check_request(
    cr_id: str,
    data: CheckRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.update_check_request(
            cr_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/check-requests/{cr_id}/submit",
    response_model=CheckRequestResponse,
)
async def submit_check_request(
    cr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.submit_check_request(
            cr_id, str(current_user.organization_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/check-requests/{cr_id}/issue",
    response_model=CheckRequestResponse,
)
async def issue_check(
    cr_id: str,
    check_number: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.issue_check(
            cr_id, str(current_user.organization_id), check_number
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/check-requests/{cr_id}/void",
    response_model=CheckRequestResponse,
)
async def void_check(
    cr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.void_check(cr_id, str(current_user.organization_id))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Dues
# ============================================


@router.get("/dues-schedules", response_model=list[DuesScheduleResponse])
async def list_dues_schedules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_dues_schedules(str(current_user.organization_id))


@router.post(
    "/dues-schedules",
    response_model=DuesScheduleResponse,
    status_code=201,
)
async def create_dues_schedule(
    data: DuesScheduleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.create_dues_schedule(
            str(current_user.organization_id),
            str(current_user.id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.put("/dues-schedules/{schedule_id}", response_model=DuesScheduleResponse)
async def update_dues_schedule(
    schedule_id: str,
    data: DuesScheduleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.update_dues_schedule(
            schedule_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/dues-schedules/{schedule_id}/generate",
    response_model=dict,
)
async def generate_member_dues(
    schedule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        count = await service.generate_member_dues(
            schedule_id, str(current_user.organization_id)
        )
        return {"generated": count}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/dues", response_model=list[MemberDuesResponse])
async def list_member_dues(
    schedule_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_member_dues(
        str(current_user.organization_id), schedule_id, user_id, status
    )


@router.put("/dues/{dues_id}", response_model=MemberDuesResponse)
async def record_dues_payment(
    dues_id: str,
    data: MemberDuesPayment,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.record_dues_payment(
            dues_id,
            str(current_user.organization_id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/dues/{dues_id}/waive", response_model=MemberDuesResponse)
async def waive_dues(
    dues_id: str,
    data: MemberDuesWaive,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.waive_dues(
            dues_id,
            str(current_user.organization_id),
            str(current_user.id),
            data.reason,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/dues/summary", response_model=DuesSummaryResponse)
async def get_dues_summary(
    schedule_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.get_dues_summary(
        str(current_user.organization_id), schedule_id
    )


# ============================================
# Export
# ============================================


@router.get("/export/mappings", response_model=list[ExportMappingResponse])
async def list_export_mappings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    return await service.list_export_mappings(str(current_user.organization_id))


@router.post(
    "/export/mappings",
    response_model=ExportMappingResponse,
    status_code=201,
)
async def create_export_mapping(
    data: ExportMappingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.create_export_mapping(
            str(current_user.organization_id),
            **data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.put("/export/mappings/{mapping_id}", response_model=ExportMappingResponse)
async def update_export_mapping(
    mapping_id: str,
    data: ExportMappingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        return await service.update_export_mapping(
            mapping_id,
            str(current_user.organization_id),
            **data.model_dump(exclude_none=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/export/transactions")
async def generate_export(
    data: ExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        csv_content, record_count = await service.generate_export(
            str(current_user.organization_id),
            str(current_user.id),
            data.date_range_start,
            data.date_range_end,
            data.file_format,
        )
        return PlainTextResponse(
            content=csv_content,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=finance_export.csv"},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/export/logs", response_model=list[ExportLogResponse])
async def list_export_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    return await service.list_export_logs(str(current_user.organization_id))


# ============================================
# Dashboard
# ============================================


@router.get("/dashboard", response_model=FinanceDashboardResponse)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    try:
        return await service.get_dashboard(str(current_user.organization_id))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
