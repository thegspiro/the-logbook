"""
Finance API Endpoints

Handles fiscal years, budgets, purchase requests, expense reports,
check requests, dues, approval chains, and QuickBooks export.
"""

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    PaginationParams,
    require_permission,
    user_has_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.finance import ApprovalEntityType
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
    ApproverCoverageResponse,
    BudgetCategoryCreate,
    BudgetCategoryResponse,
    BudgetCategoryUpdate,
    BudgetCreate,
    BudgetOptionResponse,
    BudgetResponse,
    BudgetSummaryResponse,
    BudgetUpdate,
    CheckRequestCreate,
    CheckRequestResponse,
    CheckRequestUpdate,
    DuesPaymentResponse,
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
    FinanceNamedOptionResponse,
    FiscalYearCreate,
    FiscalYearOptionResponse,
    FiscalYearResponse,
    FiscalYearUpdate,
    ManualDenyRequest,
    MemberDuesPayment,
    MemberDuesResponse,
    MemberDuesUnwaive,
    MemberDuesWaive,
    PendingApprovalResponse,
    PurchaseRequestCreate,
    PurchaseRequestResponse,
    PurchaseRequestUpdate,
    UnroutedApprovalResponse,
)
from app.services.finance_approver_matching import ApproverMismatchError
from app.services.finance_service import (
    BudgetLimitExceededError,
    FinanceEntityNotFoundError,
    FinanceService,
    ManualApprovalConflictError,
)

router = APIRouter()


# ============================================
# Who sees and acts on which requests
# ============================================
# ``finance.request`` is held by every member. It opens the requester's side of
# purchase requests, expense reports and check requests — raise, edit while
# editable, submit, withdraw a draft, and read — and only for records the
# caller raised. The OR-gates below therefore admit a baseline grant beside
# the officer ones on purpose; the ownership scoping in each handler is what
# keeps a member out of everybody else's requests (404, as if absent).


def _sees_all_requests(user: User) -> bool:
    """Org-wide read of purchase and check requests, as before finance.request."""
    return user_has_permission(user, "finance.view") or user_has_permission(
        user, "finance.manage"
    )


def _read_scope(user: User) -> Optional[str]:
    """``None`` for an org-wide reader, else the caller's id to confine reads."""
    return None if _sees_all_requests(user) else str(user.id)


def _requester_scope(user: User) -> Optional[str]:
    """``None`` when the caller may act on any request; else their own id.

    Only ``finance.manage`` acts on other members' requests. A
    ``finance.view`` holder reads the queue but, like any member, edits and
    submits only what they raised themselves.
    """
    return None if user_has_permission(user, "finance.manage") else str(user.id)


# ============================================
# Fiscal Years
# ============================================


@router.get("/fiscal-years", response_model=list[FiscalYearResponse])
async def list_fiscal_years(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_fiscal_years(
        str(current_user.organization_id), pagination
    )


@router.get("/fiscal-years/options", response_model=list[FiscalYearOptionResponse])
async def list_fiscal_year_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """Active and draft fiscal years, for the request forms' picker.

    **Requires permission: finance.request, finance.view or finance.manage**

    Id, name and status only. The full fiscal-year list stays behind
    the view grant, which is what the settings and budget pages use.
    """
    # Registered before `/fiscal-years/{fy_id}`: Starlette matches in
    # registration order, and the by-id route would otherwise capture
    # "options" as an id.
    service = FinanceService(db)
    return await service.list_fiscal_year_options(str(current_user.organization_id))


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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
            **data.model_dump(exclude_unset=True),
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Budget Categories
# ============================================


@router.get("/budget-categories", response_model=list[BudgetCategoryResponse])
async def list_budget_categories(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_budget_category_details(
        str(current_user.organization_id), pagination
    )


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
    org_id = str(current_user.organization_id)
    try:
        category = await service.create_budget_category(org_id, **data.model_dump())
        return await service.get_budget_category_detail(category.id, org_id)
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    org_id = str(current_user.organization_id)
    try:
        category = await service.update_budget_category(
            cat_id, org_id, **data.model_dump(exclude_unset=True)
        )
        return await service.get_budget_category_detail(category.id, org_id)
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Budget form options
# ============================================


@router.get("/position-options", response_model=list[FinanceNamedOptionResponse])
async def list_position_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """The department's positions, as the budget owner pickers offer them.

    **Requires permission: finance.manage**

    An id and a name and nothing else — not the position's permissions or
    members — because the Treasurer assigning an owner may not hold the
    position-administration grants ``/roles`` asks for.
    """
    service = FinanceService(db)
    return await service.list_position_options(str(current_user.organization_id))


@router.get("/station-options", response_model=list[FinanceNamedOptionResponse])
async def list_station_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """The department's facilities that are not archived, for the station picker.

    **Requires permission: finance.manage**

    An id and the name budget lines are labelled with, nothing more.
    """
    service = FinanceService(db)
    return await service.list_station_options(str(current_user.organization_id))


# ============================================
# Budgets
# ============================================


@router.get("/budgets", response_model=list[BudgetResponse])
async def list_budgets(
    fiscal_year_id: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    station_id: Optional[str] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_budget_details(
        str(current_user.organization_id),
        pagination,
        fiscal_year_id,
        category_id,
        station_id,
    )


@router.post("/budgets", response_model=BudgetResponse, status_code=201)
async def create_budget(
    data: BudgetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    org_id = str(current_user.organization_id)
    try:
        budget = await service.create_budget(
            org_id, str(current_user.id), **data.model_dump()
        )
        return await service.get_budget_detail(budget.id, org_id)
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    # Registered before `/budgets/{budget_id}` on purpose: Starlette matches
    # routes in registration order, so a fixed-path route sharing a dynamic
    # route's prefix and segment count must come first or it is permanently
    # shadowed -- a GET here previously always matched
    # get_budget(budget_id="summary") instead and 404'd.
    service = FinanceService(db)
    try:
        return await service.get_budget_summary(
            str(current_user.organization_id), fiscal_year_id
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/budgets/options", response_model=list[BudgetOptionResponse])
async def list_budget_options(
    fiscal_year_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """The budget lines of one fiscal year, as the request forms offer them.

    **Requires permission: finance.request, finance.view or finance.manage**

    Each line is a label (its category, plus its station when it has one)
    and the amount remaining. That is all a member choosing a line needs, and
    all they see: the budget pages themselves stay behind the view grant.
    """
    # Registered before `/budgets/{budget_id}` for the reason
    # get_budget_summary gives.
    service = FinanceService(db)
    return await service.list_budget_options(
        str(current_user.organization_id), fiscal_year_id
    )


@router.get("/budgets/{budget_id}", response_model=BudgetResponse)
async def get_budget(
    budget_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    budget = await service.get_budget_detail(
        budget_id, str(current_user.organization_id)
    )
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
    org_id = str(current_user.organization_id)
    try:
        budget = await service.update_budget(
            budget_id, org_id, **data.model_dump(exclude_unset=True)
        )
        return await service.get_budget_detail(budget.id, org_id)
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Approval Chains
# ============================================


@router.get("/approval-chains", response_model=list[ApprovalChainResponse])
async def list_approval_chains(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_approval_chains(
        str(current_user.organization_id), pagination
    )


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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/approval-chains/preview", response_model=ApprovalChainResponse)
async def preview_approval_chain(
    entity_type: str = Query(...),
    amount: Decimal = Query(..., decimal_places=2),
    category_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    # Registered before `/approval-chains/{chain_id}` on purpose: Starlette
    # matches routes in registration order, so a fixed-path route sharing a
    # dynamic route's prefix and segment count must come first or it is
    # permanently shadowed -- a GET here previously always matched
    # get_approval_chain(chain_id="preview") instead and 404'd.
    service = FinanceService(db)
    try:
        chain = await service.preview_approval_chain(
            str(current_user.organization_id),
            entity_type,
            amount,
            category_id,
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
    if not chain:
        raise HTTPException(
            status_code=404,
            detail="No matching approval chain found",
        )
    return chain


@router.get(
    "/approval-chains/approver-coverage",
    response_model=list[ApproverCoverageResponse],
)
async def get_approver_coverage(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.configure_approvals")),
):
    """
    Report every approval step and whether anybody can act on it

    Approve and deny are limited to a step's named approver, so a step naming
    a missing position, a departed member, an unknown permission or nobody
    active leaves its requests waiting. One row per approval step in the
    organization's chains, with the number of active members who match it,
    a ``problem`` code when nobody can, and how many requests are waiting on
    it now. Registered before ``/approval-chains/{chain_id}`` for the reason
    given on the preview route.

    **Authentication required**
    **Requires permission: finance.configure_approvals**
    """
    service = FinanceService(db)
    return await service.get_approver_coverage(str(current_user.organization_id))


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
            **data.model_dump(exclude_unset=True),
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
            **data.model_dump(exclude_unset=True),
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Approvals
# ============================================


@router.get("/approvals/pending", response_model=list[PendingApprovalResponse])
async def get_pending_approvals(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    service = FinanceService(db)
    return await service.get_pending_approvals(
        current_user,
        str(current_user.organization_id),
        skip=pagination.skip,
        limit=pagination.limit,
    )


@router.get("/approvals/unrouted", response_model=list[UnroutedApprovalResponse])
async def get_unrouted_approvals(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    """
    List requests waiting for approval that no approval chain applies to

    These have no approval steps, so they can only be decided through the
    manual approve and deny endpoints below.

    **Authentication required**
    **Requires permission: finance.approve**
    """
    service = FinanceService(db)
    return await service.get_unrouted_approvals(
        str(current_user.organization_id),
        skip=pagination.skip,
        limit=pagination.limit,
    )


def _manual_decision_error(e: Exception) -> HTTPException:
    if isinstance(e, FinanceEntityNotFoundError):
        return HTTPException(status_code=404, detail=safe_error_detail(e))
    if isinstance(e, BudgetLimitExceededError):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, ManualApprovalConflictError):
        return HTTPException(status_code=409, detail=safe_error_detail(e))
    if isinstance(e, ValueError):
        return HTTPException(status_code=400, detail=safe_error_detail(e))
    return HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/approvals/manual/{entity_type}/{entity_id}/approve",
    status_code=204,
)
async def manual_approve(
    entity_type: ApprovalEntityType,
    entity_id: str,
    data: ApprovalActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    """
    Approve a request that has no approval steps

    Only a request waiting for approval with no approval chain applied can be
    approved here; one with approval steps is approved through those steps.
    The requester cannot approve their own request.

    **Authentication required**
    **Requires permission: finance.approve**
    """
    service = FinanceService(db)
    try:
        await service.manual_approve(
            entity_type,
            entity_id,
            str(current_user.id),
            org_id=str(current_user.organization_id),
        )
        await log_audit_event(
            db=db,
            event_type="finance.manual_approval_approved",
            event_category="finance",
            severity="info",
            event_data={
                "entity_type": entity_type.value,
                "entity_id": entity_id,
                "notes": data.notes,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    except Exception as e:
        raise _manual_decision_error(e)


@router.post(
    "/approvals/manual/{entity_type}/{entity_id}/deny",
    status_code=204,
)
async def manual_deny(
    entity_type: ApprovalEntityType,
    entity_id: str,
    data: ManualDenyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.approve")),
):
    """
    Deny a request that has no approval steps

    Only a request waiting for approval with no approval chain applied can be
    denied here. A reason is required and is shown to the requester.

    **Authentication required**
    **Requires permission: finance.approve**
    """
    service = FinanceService(db)
    try:
        await service.manual_deny(
            entity_type,
            entity_id,
            str(current_user.id),
            data.reason,
            org_id=str(current_user.organization_id),
        )
        await log_audit_event(
            db=db,
            event_type="finance.manual_approval_denied",
            event_category="finance",
            severity="warning",
            event_data={"entity_type": entity_type.value, "entity_id": entity_id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
    except Exception as e:
        raise _manual_decision_error(e)


def _approval_audit_data(service: FinanceService, step_record_id: str) -> dict:
    """Audit fields saying how the caller was allowed to act on the step."""
    decision = service.last_approver_decision
    data: dict = {"step_record_id": step_record_id}
    if decision is None:
        return data
    data.update(
        {
            "override": decision.override,
            "approver_type": decision.approver_type,
            "approver_value": decision.approver_value,
        }
    )
    if decision.override:
        data["override_reason"] = decision.override_reason
    return data


def _approval_audit_severity(service: FinanceService, default: str) -> str:
    """An override is raised to warning, as scheduling's check override is."""
    decision = service.last_approver_decision
    if decision is not None and decision.override:
        return "warning"
    return default


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
    """
    Approve the approval step a request is currently waiting on

    Only the step's named approver may approve it. An approvals administrator
    (``finance.configure_approvals``) who is not the named approver may do so
    by giving ``overrideReason``; it is recorded in the audit log. The
    requester can never approve their own request. Anyone else gets 403.

    **Authentication required**
    **Requires permission: finance.approve**
    """
    service = FinanceService(db)
    try:
        record = await service.approve_step(
            step_record_id,
            current_user,
            data.notes,
            org_id=str(current_user.organization_id),
            override_reason=data.override_reason,
        )
        await log_audit_event(
            db=db,
            event_type="finance.approval_step_approved",
            event_category="finance",
            severity=_approval_audit_severity(service, "info"),
            event_data=_approval_audit_data(service, step_record_id),
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return record
    except ApproverMismatchError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    """
    Deny the approval step a request is currently waiting on

    The same approver rule as approving, including the override; a
    requester may deny (withdraw) their own request.

    **Authentication required**
    **Requires permission: finance.approve**
    """
    service = FinanceService(db)
    try:
        record = await service.deny_step(
            step_record_id,
            current_user,
            data.notes,
            org_id=str(current_user.organization_id),
            override_reason=data.override_reason,
        )
        await log_audit_event(
            db=db,
            event_type="finance.approval_step_denied",
            event_category="finance",
            severity=_approval_audit_severity(service, "warning"),
            event_data=_approval_audit_data(service, step_record_id),
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return record
    except ApproverMismatchError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """List purchase requests.

    **Requires permission: finance.request, finance.view or finance.manage**

    A caller without the view or manage grant sees only the requests they
    raised themselves.
    """
    service = FinanceService(db)
    return await service.list_purchase_requests(
        str(current_user.organization_id),
        pagination,
        status,
        fiscal_year_id,
        restrict_to_user=_read_scope(current_user),
    )


@router.post(
    "/purchase-requests",
    response_model=PurchaseRequestResponse,
    status_code=201,
)
async def create_purchase_request(
    data: PurchaseRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Raise a purchase request, as the caller.

    **Requires permission: finance.request or finance.manage**
    """
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


async def _with_approval_steps(
    service, payload, entity_type, entity_id, org_id, viewer: User
):
    """Attach the approval records for a finance document.

    `ApprovalStepRecord` is polymorphic — it keys on (entity_type, entity_id)
    and there is no ORM relationship from the document to it — so the schema's
    `approval_steps` field has nothing to read from and every detail response
    served an empty list. The records were being written correctly; the pages
    just said "No approval steps configured for this request".
    """
    steps = []
    records = await service.get_approval_records(entity_type, entity_id, org_id)
    # Who each step waits on, and whether the viewer can act on it, comes
    # from the rule approve/deny enforce (CLAUDE.md pitfall #29).
    flags = await service.step_actor_flags(viewer, records, org_id)
    for record in records:
        step = ApprovalStepRecordResponse.model_validate(record)
        for field, value in flags.get(str(record.id), {}).items():
            setattr(step, field, value)
        # `step_name` and `step_order` describe the chain step, not the record,
        # so they have to be copied across from the eager-loaded relationship —
        # otherwise every entry renders as the fallback "Step 1".
        if record.step is not None:
            step.step_name = record.step.name
            step.step_order = record.step.step_order
        steps.append(step)
    payload.approval_steps = steps
    return payload


@router.get("/purchase-requests/{pr_id}", response_model=PurchaseRequestResponse)
async def get_purchase_request(
    pr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """A purchase request, with its approval steps.

    **Requires permission: finance.request, finance.view or finance.manage**

    Another member's request is a 404 to a caller without the view or
    manage grant.
    """
    service = FinanceService(db)
    pr = await service.get_purchase_request(
        pr_id,
        str(current_user.organization_id),
        restrict_to_user=_read_scope(current_user),
    )
    if not pr:
        raise HTTPException(status_code=404, detail="Purchase request not found")
    return await _with_approval_steps(
        service,
        PurchaseRequestResponse.model_validate(pr),
        ApprovalEntityType.PURCHASE_REQUEST,
        pr.id,
        str(current_user.organization_id),
        current_user,
    )


@router.put("/purchase-requests/{pr_id}", response_model=PurchaseRequestResponse)
async def update_purchase_request(
    pr_id: str,
    data: PurchaseRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Edit a purchase request while it is still a draft or just submitted.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only the caller's own request.
    """
    service = FinanceService(db)
    try:
        return await service.update_purchase_request(
            pr_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
            **data.model_dump(exclude_unset=True),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Submit a draft purchase request for approval.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only the caller's own request.
    """
    service = FinanceService(db)
    try:
        pr = await service.submit_purchase_request(
            pr_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
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
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    actual_amount: Optional[Decimal] = Query(None, decimal_places=2),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    try:
        pr = await service.mark_pr_paid(
            pr_id,
            str(current_user.organization_id),
            actual_amount,
            acted_by=str(current_user.id),
        )
        await log_audit_event(
            db=db,
            event_type="finance.purchase_request_paid",
            event_category="finance",
            severity="info",
            event_data={
                "request_number": pr.request_number,
                "amount": str(pr.actual_amount or pr.estimated_amount),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return pr
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Cancel a purchase request.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant this is the requester withdrawing their own
    draft; anything further along is the finance office's to cancel.
    """
    service = FinanceService(db)
    try:
        return await service.cancel_purchase_request(
            pr_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """List expense reports.

    **Requires permission: finance.request, finance.view or finance.manage**

    Everyone but a finance manager sees only their own.
    """
    service = FinanceService(db)
    # A plain finance.view holder sees only their own reimbursement submissions;
    # finance managers see the whole queue (FIN-5). A finance.request holder
    # gets the same own-only view.
    restrict = (
        None
        if user_has_permission(current_user, "finance.manage")
        else str(current_user.id)
    )
    return await service.list_expense_reports(
        str(current_user.organization_id),
        pagination,
        status,
        restrict_to_user=restrict,
    )


@router.post(
    "/expense-reports",
    response_model=ExpenseReportResponse,
    status_code=201,
)
async def create_expense_report(
    data: ExpenseReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Raise an expense report, as the caller.

    **Requires permission: finance.request or finance.manage**
    """
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/expense-reports/{er_id}", response_model=ExpenseReportResponse)
async def get_expense_report(
    er_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """An expense report, with its approval steps.

    **Requires permission: finance.request, finance.view or finance.manage**

    Another member's report is a 404 to anyone but a finance manager.
    """
    service = FinanceService(db)
    restrict = (
        None
        if user_has_permission(current_user, "finance.manage")
        else str(current_user.id)
    )
    er = await service.get_expense_report(
        er_id, str(current_user.organization_id), restrict_to_user=restrict
    )
    if not er:
        raise HTTPException(status_code=404, detail="Expense report not found")
    return await _with_approval_steps(
        service,
        ExpenseReportResponse.model_validate(er),
        ApprovalEntityType.EXPENSE_REPORT,
        er.id,
        str(current_user.organization_id),
        current_user,
    )


@router.put("/expense-reports/{er_id}", response_model=ExpenseReportResponse)
async def update_expense_report(
    er_id: str,
    data: ExpenseReportUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Edit an expense report while it is still a draft or just submitted.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only the caller's own report.
    """
    service = FinanceService(db)
    try:
        return await service.update_expense_report(
            er_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
            **data.model_dump(exclude_unset=True),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Add a line item to a draft expense report.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only to the caller's own report.
    """
    service = FinanceService(db)
    try:
        return await service.add_expense_line_item(
            er_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
            **data.model_dump(),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Submit a draft expense report for approval.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only the caller's own report.
    """
    service = FinanceService(db)
    try:
        return await service.submit_expense_report(
            er_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
        er = await service.mark_expense_paid(
            er_id,
            str(current_user.organization_id),
            payment_method,
            acted_by=str(current_user.id),
        )
        await log_audit_event(
            db=db,
            event_type="finance.expense_report_paid",
            event_category="finance",
            severity="info",
            event_data={
                "report_number": er.report_number,
                "amount": str(er.total_amount),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return er
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """List check requests.

    **Requires permission: finance.request, finance.view or finance.manage**

    A caller without the view or manage grant sees only the requests they
    raised themselves.
    """
    service = FinanceService(db)
    return await service.list_check_requests(
        str(current_user.organization_id),
        pagination,
        status,
        restrict_to_user=_read_scope(current_user),
    )


@router.post(
    "/check-requests",
    response_model=CheckRequestResponse,
    status_code=201,
)
async def create_check_request(
    data: CheckRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Raise a check request, as the caller.

    **Requires permission: finance.request or finance.manage**
    """
    service = FinanceService(db)
    try:
        return await service.create_check_request(
            str(current_user.organization_id),
            str(current_user.id),
            **data.model_dump(),
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/check-requests/{cr_id}", response_model=CheckRequestResponse)
async def get_check_request(
    cr_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.view", "finance.manage")
    ),
):
    """A check request, with its approval steps.

    **Requires permission: finance.request, finance.view or finance.manage**

    Another member's request is a 404 to a caller without the view or
    manage grant.
    """
    service = FinanceService(db)
    cr = await service.get_check_request(
        cr_id,
        str(current_user.organization_id),
        restrict_to_user=_read_scope(current_user),
    )
    if not cr:
        raise HTTPException(status_code=404, detail="Check request not found")
    return await _with_approval_steps(
        service,
        CheckRequestResponse.model_validate(cr),
        ApprovalEntityType.CHECK_REQUEST,
        cr.id,
        str(current_user.organization_id),
        current_user,
    )


@router.put("/check-requests/{cr_id}", response_model=CheckRequestResponse)
async def update_check_request(
    cr_id: str,
    data: CheckRequestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Edit a check request while it is still a draft or just submitted.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only the caller's own request.
    """
    service = FinanceService(db)
    try:
        return await service.update_check_request(
            cr_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
            **data.model_dump(exclude_unset=True),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    current_user: User = Depends(
        require_permission("finance.request", "finance.manage")
    ),
):
    """Submit a draft check request for approval.

    **Requires permission: finance.request or finance.manage**

    Without the manage grant, only the caller's own request.
    """
    service = FinanceService(db)
    try:
        return await service.submit_check_request(
            cr_id,
            str(current_user.organization_id),
            requester_id=_requester_scope(current_user),
        )
    except FinanceEntityNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
        cr = await service.issue_check(
            cr_id,
            str(current_user.organization_id),
            check_number,
            acted_by=str(current_user.id),
        )
        await log_audit_event(
            db=db,
            event_type="finance.check_issued",
            event_category="finance",
            severity="info",
            event_data={
                "request_number": cr.request_number,
                "check_number": cr.check_number,
                "amount": str(cr.amount),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return cr
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
        cr = await service.void_check(cr_id, str(current_user.organization_id))
        await log_audit_event(
            db=db,
            event_type="finance.check_voided",
            event_category="finance",
            severity="warning",
            event_data={
                "request_number": cr.request_number,
                "check_number": cr.check_number,
                "amount": str(cr.amount),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return cr
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Dues
# ============================================


@router.get("/dues-schedules", response_model=list[DuesScheduleResponse])
async def list_dues_schedules(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view")),
):
    service = FinanceService(db)
    return await service.list_dues_schedules(
        str(current_user.organization_id), pagination
    )


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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
            **data.model_dump(exclude_unset=True),
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/dues", response_model=list[MemberDuesResponse])
async def list_member_dues(
    schedule_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view", "finance.manage")),
):
    # Member dues balances are individual financial records. `finance.view`
    # (roster-level read) must not expose one member's dues to another; only a
    # dues manager (`finance.manage`, the permission that records/waives
    # payments) may query across members. Everyone else is confined to their
    # own dues regardless of the requested user_id.
    if not user_has_permission(current_user, "finance.manage"):
        user_id = str(current_user.id)
    service = FinanceService(db)
    return await service.list_member_dues(
        str(current_user.organization_id), pagination, schedule_id, user_id, status
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
        dues = await service.record_dues_payment(
            dues_id,
            str(current_user.organization_id),
            recorded_by=str(current_user.id),
            **data.model_dump(),
        )
        await log_audit_event(
            db=db,
            event_type="finance.dues_payment_recorded",
            event_category="finance",
            severity="info",
            event_data={
                "dues_id": dues_id,
                "amount_paid": str(data.amount_paid),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return dues
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/dues/{dues_id}/payments", response_model=list[DuesPaymentResponse])
async def list_dues_payments(
    dues_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.view", "finance.manage")),
):
    """
    List every payment recorded against one member's dues, oldest first.

    The dues record itself carries only the derived total and the most recent
    payment's detail; this is the underlying ledger those are computed from,
    and the only place earlier payments can be read back.
    """
    service = FinanceService(db)
    try:
        viewer_user_id = None
        if not user_has_permission(current_user, "finance.manage"):
            viewer_user_id = str(current_user.id)
        return await service.list_dues_payments(
            dues_id,
            str(current_user.organization_id),
            viewer_user_id=viewer_user_id,
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))
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
        dues = await service.waive_dues(
            dues_id,
            str(current_user.organization_id),
            str(current_user.id),
            data.reason,
        )
        await log_audit_event(
            db=db,
            event_type="finance.dues_waived",
            event_category="finance",
            severity="warning",
            event_data={"dues_id": dues_id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return dues
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/dues/{dues_id}/unwaive", response_model=MemberDuesResponse)
async def unwaive_dues(
    dues_id: str,
    data: MemberDuesUnwaive,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    """
    Reverse a waiver, returning the dues to whatever the payment ledger says.

    Payments against waived dues are refused, so this is the only way back —
    the case being "waived by mistake, then the member paid".
    """
    service = FinanceService(db)
    try:
        dues = await service.unwaive_dues(
            dues_id,
            str(current_user.organization_id),
            data.reason,
        )
        await log_audit_event(
            db=db,
            event_type="finance.dues_waiver_reversed",
            event_category="finance",
            severity="warning",
            event_data={
                "dues_id": dues_id,
                "restored_status": dues.status.value,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return dues
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    return await service.list_export_mappings(
        str(current_user.organization_id), pagination
    )


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
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
            **data.model_dump(exclude_unset=True),
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
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
        csv_stream = await service.generate_export(
            str(current_user.organization_id),
            str(current_user.id),
            data.date_range_start,
            data.date_range_end,
            data.file_format,
        )
        return StreamingResponse(
            content=csv_stream,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=finance_export.csv"},
        )
    except BudgetLimitExceededError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/export/logs", response_model=list[ExportLogResponse])
async def list_export_logs(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("finance.manage")),
):
    service = FinanceService(db)
    return await service.list_export_logs(str(current_user.organization_id), pagination)


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
