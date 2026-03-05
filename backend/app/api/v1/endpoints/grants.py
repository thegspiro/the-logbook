"""
Grants & Fundraising API Endpoints

Endpoints for grant opportunity management, grant applications, budget tracking,
expenditures, compliance tasks, fundraising campaigns, donors, donations,
pledges, fundraising events, and reporting.
"""

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.grant import (
    CampaignCreate,
    CampaignResponse,
    CampaignUpdate,
    DonationCreate,
    DonationResponse,
    DonationUpdate,
    DonorCreate,
    DonorResponse,
    DonorUpdate,
    FundraisingEventCreate,
    FundraisingEventResponse,
    FundraisingEventUpdate,
    FundraisingReportResponse,
    GrantApplicationCreate,
    GrantApplicationListResponse,
    GrantApplicationResponse,
    GrantApplicationUpdate,
    GrantBudgetItemCreate,
    GrantBudgetItemResponse,
    GrantBudgetItemUpdate,
    GrantComplianceTaskCreate,
    GrantComplianceTaskResponse,
    GrantComplianceTaskUpdate,
    GrantExpenditureCreate,
    GrantExpenditureResponse,
    GrantExpenditureUpdate,
    GrantNoteCreate,
    GrantNoteResponse,
    GrantOpportunityCreate,
    GrantOpportunityResponse,
    GrantOpportunityUpdate,
    GrantReportResponse,
    GrantsDashboardResponse,
    PledgeCreate,
    PledgeResponse,
    PledgeUpdate,
)
from app.services.fundraising_service import FundraisingService
from app.services.grant_service import GrantService

router = APIRouter()


# ============================================
# Grant Opportunity Endpoints
# ============================================


@router.get("", response_model=list[GrantOpportunityResponse])
async def list_opportunities(
    category: Optional[str] = Query(None, description="Filter by grant category"),
    active_only: bool = Query(True, description="Only return active opportunities"),
    search: Optional[str] = Query(None, description="Search by name, agency, or description"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List grant opportunities

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        opportunities = await service.list_opportunities(
            organization_id=str(current_user.organization_id),
            category=category,
            active_only=active_only,
            search=search,
        )
        return opportunities
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing grant opportunities: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "",
    response_model=GrantOpportunityResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_opportunity(
    data: GrantOpportunityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new grant opportunity

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        opportunity = await service.create_opportunity(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        return opportunity
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating grant opportunity: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.get("/{opportunity_id}", response_model=GrantOpportunityResponse)
async def get_opportunity(
    opportunity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get a single grant opportunity by ID

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        opportunity = await service.get_opportunity(
            opportunity_id=str(opportunity_id),
            organization_id=str(current_user.organization_id),
        )
        if not opportunity:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Grant opportunity not found",
            )
        return opportunity
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting grant opportunity: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/{opportunity_id}", response_model=GrantOpportunityResponse)
async def update_opportunity(
    opportunity_id: UUID,
    data: GrantOpportunityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a grant opportunity

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        opportunity = await service.update_opportunity(
            opportunity_id=str(opportunity_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not opportunity:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Grant opportunity not found",
            )
        return opportunity
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating grant opportunity: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.delete("/{opportunity_id}", status_code=status.HTTP_200_OK)
async def delete_opportunity(
    opportunity_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Delete a grant opportunity

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        deleted = await service.delete_opportunity(
            opportunity_id=str(opportunity_id),
            organization_id=str(current_user.organization_id),
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Grant opportunity not found",
            )
        return {"detail": "Grant opportunity deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting grant opportunity: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Grant Application Endpoints
# ============================================


@router.get("/applications", response_model=list[GrantApplicationListResponse])
async def list_applications(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by application status"),
    priority: Optional[str] = Query(None, description="Filter by priority"),
    assigned_to: Optional[UUID] = Query(None, description="Filter by assigned user"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List grant applications

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        applications = await service.list_applications(
            organization_id=str(current_user.organization_id),
            status=status_filter,
            priority=priority,
            assigned_to=str(assigned_to) if assigned_to else None,
        )
        return applications
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing grant applications: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/applications",
    response_model=GrantApplicationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_application(
    data: GrantApplicationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        application = await service.create_application(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        # Reload with relationships for response serialization
        application = await service.get_application(
            application_id=application.id,
            organization_id=str(current_user.organization_id),
        )
        return application
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating grant application: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.get("/applications/{application_id}", response_model=GrantApplicationResponse)
async def get_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get a single grant application with budget_items, expenditures,
    compliance_tasks, and notes

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        application = await service.get_application(
            application_id=str(application_id),
            organization_id=str(current_user.organization_id),
        )
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Grant application not found",
            )
        return application
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting grant application: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/applications/{application_id}", response_model=GrantApplicationResponse)
async def update_application(
    application_id: UUID,
    data: GrantApplicationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        application = await service.update_application(
            application_id=str(application_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Grant application not found",
            )
        # Reload with fresh relationships (status changes may add notes/tasks)
        application = await service.get_application(
            application_id=str(application_id),
            organization_id=str(current_user.organization_id),
        )
        return application
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating grant application: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.delete("/applications/{application_id}", status_code=status.HTTP_200_OK)
async def delete_application(
    application_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Delete a grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        deleted = await service.delete_application(
            application_id=str(application_id),
            organization_id=str(current_user.organization_id),
            user_id=str(current_user.id),
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Grant application not found",
            )
        return {"detail": "Grant application deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting grant application: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Grant Budget Item Endpoints
# ============================================


@router.get(
    "/applications/{app_id}/budget-items",
    response_model=list[GrantBudgetItemResponse],
)
async def list_budget_items(
    app_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List budget items for a grant application

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        items = await service.list_budget_items(
            application_id=str(app_id),
            organization_id=str(current_user.organization_id),
        )
        return items
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing budget items: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/applications/{app_id}/budget-items",
    response_model=GrantBudgetItemResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_budget_item(
    app_id: UUID,
    data: GrantBudgetItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a budget item for a grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        item_data = data.model_dump(exclude_unset=True)
        # Override application_id from URL path
        item_data.pop("application_id", None)
        item = await service.create_budget_item(
            application_id=str(app_id),
            organization_id=str(current_user.organization_id),
            data=item_data,
        )
        return item
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating budget item: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/budget-items/{item_id}", response_model=GrantBudgetItemResponse)
async def update_budget_item(
    item_id: UUID,
    data: GrantBudgetItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a grant budget item

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        item = await service.update_budget_item(
            item_id=str(item_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Budget item not found",
            )
        return item
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating budget item: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.delete("/budget-items/{item_id}", status_code=status.HTTP_200_OK)
async def delete_budget_item(
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Delete a grant budget item

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        deleted = await service.delete_budget_item(item_id=str(item_id))
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Budget item not found",
            )
        return {"detail": "Budget item deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting budget item: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Grant Expenditure Endpoints
# ============================================


@router.get(
    "/applications/{app_id}/expenditures",
    response_model=list[GrantExpenditureResponse],
)
async def list_expenditures(
    app_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List expenditures for a grant application

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        expenditures = await service.list_expenditures(
            application_id=str(app_id),
            organization_id=str(current_user.organization_id),
        )
        return expenditures
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing expenditures: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/applications/{app_id}/expenditures",
    response_model=GrantExpenditureResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_expenditure(
    app_id: UUID,
    data: GrantExpenditureCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create an expenditure for a grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        exp_data = data.model_dump(exclude_unset=True)
        # Override application_id from URL path
        exp_data.pop("application_id", None)
        expenditure = await service.create_expenditure(
            application_id=str(app_id),
            organization_id=str(current_user.organization_id),
            data=exp_data,
            user_id=str(current_user.id),
        )
        return expenditure
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating expenditure: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/expenditures/{expenditure_id}", response_model=GrantExpenditureResponse)
async def update_expenditure(
    expenditure_id: UUID,
    data: GrantExpenditureUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a grant expenditure

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        expenditure = await service.update_expenditure(
            expenditure_id=str(expenditure_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not expenditure:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Expenditure not found",
            )
        return expenditure
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating expenditure: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.delete("/expenditures/{expenditure_id}", status_code=status.HTTP_200_OK)
async def delete_expenditure(
    expenditure_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Delete a grant expenditure

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        deleted = await service.delete_expenditure(
            expenditure_id=str(expenditure_id),
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Expenditure not found",
            )
        return {"detail": "Expenditure deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting expenditure: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Grant Compliance Task Endpoints
# ============================================


@router.get("/compliance-tasks", response_model=list[GrantComplianceTaskResponse])
async def list_compliance_tasks(
    application_id: Optional[UUID] = Query(None, description="Filter by application"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by task status"),
    due_before: Optional[date] = Query(None, description="Filter tasks due before this date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List all compliance tasks across grant applications

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        tasks = await service.list_compliance_tasks(
            organization_id=str(current_user.organization_id),
            application_id=str(application_id) if application_id else None,
            status=status_filter,
            due_before=due_before,
        )
        return tasks
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing compliance tasks: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/applications/{app_id}/compliance-tasks",
    response_model=GrantComplianceTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_compliance_task(
    app_id: UUID,
    data: GrantComplianceTaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a compliance task for a grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        task_data = data.model_dump(exclude_unset=True)
        # Override application_id from URL path
        task_data.pop("application_id", None)
        task = await service.create_compliance_task(
            application_id=str(app_id),
            organization_id=str(current_user.organization_id),
            data=task_data,
            user_id=str(current_user.id),
        )
        return task
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating compliance task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/compliance-tasks/{task_id}", response_model=GrantComplianceTaskResponse)
async def update_compliance_task(
    task_id: UUID,
    data: GrantComplianceTaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a compliance task (including marking complete)

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        task = await service.update_compliance_task(
            task_id=str(task_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Compliance task not found",
            )
        return task
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating compliance task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.delete("/compliance-tasks/{task_id}", status_code=status.HTTP_200_OK)
async def delete_compliance_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Delete a compliance task

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        deleted = await service.delete_compliance_task(task_id=str(task_id))
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Compliance task not found",
            )
        return {"detail": "Compliance task deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting compliance task: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Grant Note Endpoints
# ============================================


@router.get(
    "/applications/{app_id}/notes",
    response_model=list[GrantNoteResponse],
)
async def list_notes(
    app_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List notes for a grant application

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        notes = await service.list_notes(application_id=str(app_id))
        return notes
    except Exception as e:
        logger.error(f"Error listing grant notes: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/applications/{app_id}/notes",
    response_model=GrantNoteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_note(
    app_id: UUID,
    data: GrantNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a note for a grant application

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = GrantService(db)
        note_data = data.model_dump(exclude_unset=True)
        # Override application_id from URL path
        note_data.pop("application_id", None)
        note = await service.create_note(
            application_id=str(app_id),
            data=note_data,
            user_id=str(current_user.id),
        )
        return note
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating grant note: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Fundraising Campaign Endpoints
# ============================================


@router.get("/campaigns", response_model=list[CampaignResponse])
async def list_campaigns(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by campaign status"),
    campaign_type: Optional[str] = Query(None, description="Filter by campaign type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List fundraising campaigns

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        campaigns = await service.list_campaigns(
            organization_id=str(current_user.organization_id),
            status=status_filter,
            campaign_type=campaign_type,
        )
        return campaigns
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing campaigns: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/campaigns",
    response_model=CampaignResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_campaign(
    data: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new fundraising campaign

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        campaign = await service.create_campaign(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        return campaign
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating campaign: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.get("/campaigns/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(
    campaign_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get a single fundraising campaign

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        campaign = await service.get_campaign(
            campaign_id=str(campaign_id),
            organization_id=str(current_user.organization_id),
        )
        if not campaign:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campaign not found",
            )
        return campaign
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting campaign: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/campaigns/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: UUID,
    data: CampaignUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a fundraising campaign

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        campaign = await service.update_campaign(
            campaign_id=str(campaign_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not campaign:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campaign not found",
            )
        return campaign
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating campaign: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.delete("/campaigns/{campaign_id}", status_code=status.HTTP_200_OK)
async def delete_campaign(
    campaign_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Soft delete a fundraising campaign (sets active=False)

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        deleted = await service.delete_campaign(
            campaign_id=str(campaign_id),
            organization_id=str(current_user.organization_id),
        )
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Campaign not found",
            )
        return {"detail": "Campaign deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting campaign: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Donor Endpoints
# ============================================


@router.get("/donors", response_model=list[DonorResponse])
async def list_donors(
    search: Optional[str] = Query(None, description="Search by name, email, or company"),
    donor_type: Optional[str] = Query(None, description="Filter by donor type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List donors

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        donors = await service.list_donors(
            organization_id=str(current_user.organization_id),
            donor_type=donor_type,
            search=search,
        )
        return donors
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing donors: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/donors",
    response_model=DonorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_donor(
    data: DonorCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new donor

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        donor = await service.create_donor(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        return donor
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating donor: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.get("/donors/{donor_id}", response_model=DonorResponse)
async def get_donor(
    donor_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get a single donor

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        donor = await service.get_donor(
            donor_id=str(donor_id),
            organization_id=str(current_user.organization_id),
        )
        if not donor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Donor not found",
            )
        return donor
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting donor: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/donors/{donor_id}", response_model=DonorResponse)
async def update_donor(
    donor_id: UUID,
    data: DonorUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a donor

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        donor = await service.update_donor(
            donor_id=str(donor_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not donor:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Donor not found",
            )
        return donor
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating donor: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Donation Endpoints
# ============================================


@router.get("/donations", response_model=list[DonationResponse])
async def list_donations(
    campaign_id: Optional[UUID] = Query(None, description="Filter by campaign"),
    donor_id: Optional[UUID] = Query(None, description="Filter by donor"),
    start_date: Optional[date] = Query(None, description="Filter donations from this date"),
    end_date: Optional[date] = Query(None, description="Filter donations until this date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List donations

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        donations = await service.list_donations(
            organization_id=str(current_user.organization_id),
            campaign_id=str(campaign_id) if campaign_id else None,
            donor_id=str(donor_id) if donor_id else None,
            start_date=start_date,
            end_date=end_date,
        )
        return donations
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing donations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/donations",
    response_model=DonationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_donation(
    data: DonationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new donation

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        donation = await service.create_donation(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        return donation
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating donation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/donations/{donation_id}", response_model=DonationResponse)
async def update_donation(
    donation_id: UUID,
    data: DonationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a donation

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        donation = await service.update_donation(
            donation_id=str(donation_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not donation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Donation not found",
            )
        return donation
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating donation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Pledge Endpoints
# ============================================


@router.get("/pledges", response_model=list[PledgeResponse])
async def list_pledges(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by pledge status"),
    campaign_id: Optional[UUID] = Query(None, description="Filter by campaign"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List pledges

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        pledges = await service.list_pledges(
            organization_id=str(current_user.organization_id),
            status=status_filter,
            campaign_id=str(campaign_id) if campaign_id else None,
        )
        return pledges
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing pledges: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/pledges",
    response_model=PledgeResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_pledge(
    data: PledgeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new pledge

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        pledge = await service.create_pledge(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        return pledge
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating pledge: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put("/pledges/{pledge_id}", response_model=PledgeResponse)
async def update_pledge(
    pledge_id: UUID,
    data: PledgeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a pledge

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        pledge = await service.update_pledge(
            pledge_id=str(pledge_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not pledge:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Pledge not found",
            )
        return pledge
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating pledge: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Fundraising Event Endpoints
# ============================================


@router.get("/fundraising-events", response_model=list[FundraisingEventResponse])
async def list_fundraising_events(
    campaign_id: Optional[UUID] = Query(None, description="Filter by campaign"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by event status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    List fundraising events

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        events = await service.list_fundraising_events(
            organization_id=str(current_user.organization_id),
            campaign_id=str(campaign_id) if campaign_id else None,
            status=status_filter,
        )
        return events
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error listing fundraising events: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.post(
    "/fundraising-events",
    response_model=FundraisingEventResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_fundraising_event(
    data: FundraisingEventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Create a new fundraising event

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        event = await service.create_fundraising_event(
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
            user_id=str(current_user.id),
        )
        return event
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error creating fundraising event: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.put(
    "/fundraising-events/{event_id}",
    response_model=FundraisingEventResponse,
)
async def update_fundraising_event(
    event_id: UUID,
    data: FundraisingEventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.manage")),
):
    """
    Update a fundraising event

    **Authentication required**
    **Requires permission: fundraising.manage**
    """
    try:
        service = FundraisingService(db)
        event = await service.update_fundraising_event(
            event_id=str(event_id),
            organization_id=str(current_user.organization_id),
            data=data.model_dump(exclude_unset=True),
        )
        if not event:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Fundraising event not found",
            )
        return event
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error updating fundraising event: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


# ============================================
# Dashboard & Report Endpoints
# ============================================


@router.get("/dashboard", response_model=GrantsDashboardResponse)
async def get_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get combined grants and fundraising dashboard

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        org_id = str(current_user.organization_id)
        grant_service = GrantService(db)
        fundraising_service = FundraisingService(db)

        grant_data = await grant_service.get_dashboard_data(org_id)
        fundraising_data = await fundraising_service.get_dashboard_data(org_id)

        return GrantsDashboardResponse(
            total_raised_ytd=fundraising_data.get("total_raised_ytd", 0),
            total_raised_12mo=fundraising_data.get("total_raised_12mo", 0),
            active_campaigns_count=fundraising_data.get("active_campaigns_count", 0),
            active_campaigns=fundraising_data.get("active_campaigns", []),
            pending_applications=grant_data.get("pending_applications", 0),
            active_grants=grant_data.get("active_grants", 0),
            upcoming_deadlines=grant_data.get("upcoming_deadlines", []),
            recent_donations=fundraising_data.get("recent_donations", []),
            compliance_tasks_due=grant_data.get("compliance_tasks_due", []),
            total_grant_funding=grant_data.get("total_grant_funding", 0),
            total_donors=fundraising_data.get("total_donors", 0),
            outstanding_pledges=fundraising_data.get("outstanding_pledges", 0),
            pipeline_summary=grant_data.get("pipeline_summary", []),
        )
    except Exception as e:
        logger.error(f"Error getting dashboard: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.get("/reports/grants", response_model=GrantReportResponse)
async def get_grant_report(
    start_date: Optional[date] = Query(None, description="Report start date"),
    end_date: Optional[date] = Query(None, description="Report end date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get grant report with application statistics, spending, and compliance

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = GrantService(db)
        report = await service.get_grant_report(
            organization_id=str(current_user.organization_id),
            start_date=start_date,
            end_date=end_date,
        )
        return report
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error generating grant report: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )


@router.get("/reports/fundraising", response_model=FundraisingReportResponse)
async def get_fundraising_report(
    start_date: Optional[date] = Query(None, description="Report start date"),
    end_date: Optional[date] = Query(None, description="Report end date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("fundraising.view")),
):
    """
    Get fundraising report with donation statistics and trends

    **Authentication required**
    **Requires permission: fundraising.view**
    """
    try:
        service = FundraisingService(db)
        report = await service.get_fundraising_report(
            organization_id=str(current_user.organization_id),
            start_date=start_date,
            end_date=end_date,
        )
        return report
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=safe_error_detail(e),
        )
    except Exception as e:
        logger.error(f"Error generating fundraising report: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=safe_error_detail(e),
        )
