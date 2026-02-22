"""
Membership Pipeline API Endpoints

Endpoints for managing prospective member pipelines, prospects,
step progression, and transfer to full membership.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.models.user import User
from app.schemas.membership_pipeline import (
    PipelineCreate,
    PipelineUpdate,
    PipelineResponse,
    PipelineListResponse,
    PipelineStepCreate,
    PipelineStepUpdate,
    PipelineStepResponse,
    StepReorderRequest,
    ProspectCreate,
    ProspectUpdate,
    ProspectResponse,
    ProspectListResponse,
    CompleteStepRequest,
    AdvanceProspectRequest,
    TransferProspectRequest,
    TransferProspectResponse,
    ActivityLogResponse,
    PipelineKanbanResponse,
    PipelineKanbanColumn,
    PipelineStatsResponse,
    PipelineStageStats,
    PurgeInactiveRequest,
    PurgeInactiveResponse,
    ProspectDocumentResponse,
    ElectionPackageCreate,
    ElectionPackageUpdate,
    ElectionPackageResponse,
)
from app.services.membership_pipeline_service import MembershipPipelineService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Pipeline Endpoints
# ============================================

@router.get("/pipelines", response_model=List[PipelineListResponse])
async def list_pipelines(
    include_templates: bool = Query(True, description="Include template pipelines"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    List all membership pipelines for the organization.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    pipelines = await service.list_pipelines(
        current_user.organization_id, include_templates
    )

    result = []
    for p in pipelines:
        result.append(PipelineListResponse(
            id=p.id,
            name=p.name,
            description=p.description,
            is_template=p.is_template,
            is_default=p.is_default,
            is_active=p.is_active if hasattr(p, 'is_active') else True,
            auto_transfer_on_approval=p.auto_transfer_on_approval,
            step_count=len(p.steps) if p.steps else 0,
            prospect_count=len(p.prospects) if hasattr(p, 'prospects') and p.prospects else 0,
            created_at=p.created_at,
        ))
    return result


@router.post("/pipelines", response_model=PipelineResponse, status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    data: PipelineCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Create a new membership pipeline.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    steps = None
    if data.steps:
        steps = [s.model_dump() for s in data.steps]

    pipeline = await service.create_pipeline(
        organization_id=current_user.organization_id,
        name=data.name,
        description=data.description,
        is_template=data.is_template,
        is_default=data.is_default,
        is_active=data.is_active,
        auto_transfer_on_approval=data.auto_transfer_on_approval,
        inactivity_config=data.inactivity_config,
        steps=steps,
        created_by=current_user.id,
    )
    return pipeline


@router.get("/pipelines/{pipeline_id}", response_model=PipelineResponse)
async def get_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    Get a single pipeline with its steps.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    pipeline = await service.get_pipeline(str(pipeline_id), current_user.organization_id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return pipeline


@router.put("/pipelines/{pipeline_id}", response_model=PipelineResponse)
async def update_pipeline(
    pipeline_id: UUID,
    data: PipelineUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Update a pipeline's properties.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    pipeline = await service.update_pipeline(
        str(pipeline_id),
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return pipeline


@router.delete("/pipelines/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pipeline(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Delete a pipeline.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    deleted = await service.delete_pipeline(str(pipeline_id), current_user.organization_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")


@router.post("/pipelines/{pipeline_id}/duplicate", response_model=PipelineResponse, status_code=status.HTTP_201_CREATED)
async def duplicate_pipeline(
    pipeline_id: UUID,
    name: str = Query(..., description="Name for the duplicated pipeline"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Duplicate a pipeline (useful for creating from templates).

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    pipeline = await service.duplicate_pipeline(
        str(pipeline_id),
        current_user.organization_id,
        new_name=name,
        created_by=current_user.id,
    )
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source pipeline not found")
    return pipeline


@router.post("/pipelines/{pipeline_id}/seed-templates", status_code=status.HTTP_201_CREATED)
async def seed_templates(
    pipeline_id: str = "default",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Seed default pipeline templates for the organization.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    await service.seed_default_templates(current_user.organization_id, current_user.id)
    return {"message": "Default pipeline templates created"}


# ============================================
# Pipeline Step Endpoints
# ============================================

@router.get("/pipelines/{pipeline_id}/steps", response_model=List[PipelineStepResponse])
async def list_steps(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    List all steps for a pipeline.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    pipeline = await service.get_pipeline(str(pipeline_id), current_user.organization_id)
    if not pipeline:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return sorted(pipeline.steps, key=lambda s: s.sort_order)


@router.post("/pipelines/{pipeline_id}/steps", response_model=PipelineStepResponse, status_code=status.HTTP_201_CREATED)
async def add_step(
    pipeline_id: UUID,
    data: PipelineStepCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Add a step to a pipeline.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    step = await service.add_step(
        str(pipeline_id),
        current_user.organization_id,
        data.model_dump(),
    )
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return step


@router.put("/pipelines/{pipeline_id}/steps/{step_id}", response_model=PipelineStepResponse)
async def update_step(
    pipeline_id: UUID,
    step_id: UUID,
    data: PipelineStepUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Update a pipeline step.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    step = await service.update_step(
        str(step_id),
        str(pipeline_id),
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
    )
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step or pipeline not found")
    return step


@router.delete("/pipelines/{pipeline_id}/steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_step(
    pipeline_id: UUID,
    step_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Remove a step from a pipeline.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    deleted = await service.delete_step(
        str(step_id), str(pipeline_id), current_user.organization_id
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step or pipeline not found")


@router.put("/pipelines/{pipeline_id}/steps/reorder", response_model=List[PipelineStepResponse])
async def reorder_steps(
    pipeline_id: UUID,
    data: StepReorderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Reorder steps in a pipeline by providing an ordered list of step IDs.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    steps = await service.reorder_steps(
        str(pipeline_id),
        current_user.organization_id,
        [str(sid) for sid in data.step_ids],
    )
    if steps is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return steps


# ============================================
# Kanban Board Endpoint
# ============================================

@router.get("/pipelines/{pipeline_id}/kanban")
async def get_kanban_board(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    Get the kanban board view for a pipeline.

    Returns prospects grouped by their current step.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    board = await service.get_kanban_board(str(pipeline_id), current_user.organization_id)
    if not board:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return board


# ============================================
# Pipeline Statistics
# ============================================

@router.get("/pipelines/{pipeline_id}/stats", response_model=PipelineStatsResponse)
async def get_pipeline_stats(
    pipeline_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    Get statistics for a pipeline (counts by status, by step, conversion rate).

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    stats = await service.get_pipeline_stats(str(pipeline_id), current_user.organization_id)
    if not stats:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found")
    return stats


# ============================================
# Purge Inactive Prospects
# ============================================

@router.post("/pipelines/{pipeline_id}/purge-inactive", response_model=PurgeInactiveResponse)
async def purge_inactive_prospects(
    pipeline_id: UUID,
    data: PurgeInactiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Purge withdrawn/inactive prospects from a pipeline.

    Requires `confirm: true` in the request body to execute.

    **Requires permission: members.manage**
    """
    if not data.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must set confirm=true to execute purge",
        )

    service = MembershipPipelineService(db)
    prospect_ids = [str(pid) for pid in data.prospect_ids] if data.prospect_ids else None
    count = await service.purge_inactive_prospects(
        pipeline_id=str(pipeline_id),
        organization_id=current_user.organization_id,
        prospect_ids=prospect_ids,
        purged_by=current_user.id,
    )
    return PurgeInactiveResponse(
        purged_count=count,
        message=f"Successfully purged {count} withdrawn prospect(s)",
    )


# ============================================
# Prospect Endpoints
# ============================================

@router.get("/prospects")
async def list_prospects(
    pipeline_id: Optional[UUID] = Query(None, description="Filter by pipeline"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by name or email"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    List prospective members with optional filters.

    Returns paginated results with total count for proper pagination.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    prospects, total = await service.list_prospects(
        organization_id=current_user.organization_id,
        pipeline_id=str(pipeline_id) if pipeline_id else None,
        status=status_filter,
        search=search,
        limit=limit,
        offset=offset,
    )

    items = []
    for p in prospects:
        items.append(ProspectListResponse(
            id=p.id,
            first_name=p.first_name,
            last_name=p.last_name,
            email=p.email,
            phone=p.phone,
            status=p.status.value if hasattr(p.status, 'value') else p.status,
            pipeline_id=p.pipeline_id,
            pipeline_name=p.pipeline.name if p.pipeline else None,
            current_step_id=p.current_step_id,
            current_step_name=p.current_step.name if p.current_step else None,
            created_at=p.created_at,
        ))
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/prospects/check-existing")
async def check_existing_members_for_prospect(
    email: str = Query(..., description="Email to check against existing members"),
    first_name: Optional[str] = Query(None, description="First name for name matching"),
    last_name: Optional[str] = Query(None, description="Last name for name matching"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.create", "prospective_members.manage")),
):
    """
    Check if a prospective member matches any existing users in the organization.

    Call this before creating a prospect or transferring them to membership.
    Returns any matches (active, archived, dropped, etc.) so leadership can
    decide whether to reactivate an archived member instead of creating a
    duplicate entry.

    **Requires permission: members.create**
    """
    service = MembershipPipelineService(db)
    matches = await service.check_existing_members(
        organization_id=current_user.organization_id,
        email=email,
        first_name=first_name,
        last_name=last_name,
    )
    return {
        "has_matches": len(matches) > 0,
        "match_count": len(matches),
        "matches": matches,
    }


@router.post("/prospects", response_model=ProspectResponse, status_code=status.HTTP_201_CREATED)
async def create_prospect(
    data: ProspectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.create", "prospective_members.manage")),
):
    """
    Add a new prospective member manually.

    Before creating, the system checks for existing members with the same
    email. If an archived member is found, a 409 Conflict is returned with
    the match details and a recommendation to reactivate instead.

    **Requires permission: members.create**
    """
    service = MembershipPipelineService(db)

    # Check for existing members (especially archived) before creating
    matches = await service.check_existing_members(
        organization_id=current_user.organization_id,
        email=data.email,
        first_name=data.first_name,
        last_name=data.last_name,
    )
    archived_matches = [m for m in matches if m["status"] == "archived"]
    if archived_matches:
        match = archived_matches[0]
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": (
                    f"A previously archived member matches this prospect: "
                    f"{match['name']} ({match['email']}). "
                    f"Consider reactivating their account instead of creating a new prospect."
                ),
                "existing_member_match": match,
                "reactivate_url": f"/api/v1/users/{match['user_id']}/reactivate",
            },
        )

    prospect_data = data.model_dump(by_alias=True)
    # Rename 'metadata' key to 'metadata_' for the model
    if "metadata" in prospect_data:
        prospect_data["metadata_"] = prospect_data.pop("metadata")
    if "pipeline_id" in prospect_data and prospect_data["pipeline_id"]:
        prospect_data["pipeline_id"] = str(prospect_data["pipeline_id"])
    if "referred_by" in prospect_data and prospect_data["referred_by"]:
        prospect_data["referred_by"] = str(prospect_data["referred_by"])

    prospect = await service.create_prospect(
        organization_id=current_user.organization_id,
        data=prospect_data,
        created_by=current_user.id,
    )
    return prospect


@router.get("/prospects/{prospect_id}", response_model=ProspectResponse)
async def get_prospect(
    prospect_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    Get a prospective member's full details including step progress.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    prospect = await service.get_prospect(str(prospect_id), current_user.organization_id)
    if not prospect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    return prospect


@router.put("/prospects/{prospect_id}", response_model=ProspectResponse)
async def update_prospect(
    prospect_id: UUID,
    data: ProspectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Update a prospective member's information.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    prospect = await service.update_prospect(
        str(prospect_id),
        current_user.organization_id,
        data.model_dump(exclude_unset=True),
        updated_by=current_user.id,
    )
    if not prospect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    return prospect


@router.delete("/prospects/{prospect_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prospect(
    prospect_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Delete a prospective member and all associated data.

    Only prospects with status withdrawn or rejected can be deleted.
    Active or transferred prospects cannot be deleted.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    deleted = await service.delete_prospect(
        str(prospect_id), current_user.organization_id, deleted_by=current_user.id
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found or cannot be deleted")


@router.post("/prospects/{prospect_id}/complete-step", response_model=ProspectResponse)
async def complete_step(
    prospect_id: UUID,
    data: CompleteStepRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Mark a pipeline step as completed for a prospect.

    If the step is the final step and auto-transfer is enabled on the pipeline,
    the prospect will be automatically transferred to full membership.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    prospect = await service.complete_step(
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        step_id=str(data.step_id),
        completed_by=current_user.id,
        notes=data.notes,
        action_result=data.action_result,
    )
    if not prospect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    return prospect


@router.post("/prospects/{prospect_id}/advance", response_model=ProspectResponse)
async def advance_prospect(
    prospect_id: UUID,
    data: AdvanceProspectRequest = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Advance a prospect to the next step in the pipeline.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    prospect = await service.advance_prospect(
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        advanced_by=current_user.id,
        notes=data.notes if data else None,
    )
    if not prospect:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    return prospect


@router.post("/prospects/{prospect_id}/transfer", response_model=TransferProspectResponse)
async def transfer_prospect(
    prospect_id: UUID,
    data: TransferProspectRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Transfer a prospect to full membership (creates a User record).

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    result = await service.transfer_to_membership(
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        transferred_by=current_user.id,
        username=data.username,
        membership_id=data.membership_id,
        rank=data.rank,
        station=data.station,
        role_ids=[str(rid) for rid in data.role_ids] if data.role_ids else None,
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    if not result.get("success"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.get("message"))
    return result


@router.get("/prospects/{prospect_id}/activity", response_model=List[ActivityLogResponse])
async def get_prospect_activity(
    prospect_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    Get the activity log for a prospect.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    logs = await service.get_activity_log(
        str(prospect_id), current_user.organization_id, limit
    )

    result = []
    for log in logs:
        result.append(ActivityLogResponse(
            id=log.id,
            prospect_id=log.prospect_id,
            action=log.action,
            details=log.details,
            performed_by=log.performed_by,
            performer_name=log.performer.full_name if log.performer else None,
            created_at=log.created_at,
        ))
    return result


# ============================================
# Prospect Document Endpoints
# ============================================

@router.get("/prospects/{prospect_id}/documents", response_model=List[ProspectDocumentResponse])
async def list_prospect_documents(
    prospect_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    List all documents for a prospect.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    docs = await service.get_prospect_documents(str(prospect_id), current_user.organization_id)
    return docs


@router.post(
    "/prospects/{prospect_id}/documents",
    response_model=ProspectDocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_prospect_document(
    prospect_id: UUID,
    document_type: str = Query(..., description="Type of document (e.g. application, id, background_check)"),
    file_name: str = Query(..., description="Original file name"),
    file_path: str = Query(..., description="Storage path for the file"),
    file_size: int = Query(0, ge=0, description="File size in bytes"),
    mime_type: Optional[str] = Query(None, description="MIME type of the file"),
    step_id: Optional[UUID] = Query(None, description="Associated pipeline step"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Add a document record for a prospect.

    Note: The actual file upload should be handled by a separate file storage service.
    This endpoint records the document metadata.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    doc = await service.add_prospect_document(
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        document_type=document_type,
        file_name=file_name,
        file_path=file_path,
        file_size=file_size,
        mime_type=mime_type,
        step_id=str(step_id) if step_id else None,
        uploaded_by=current_user.id,
    )
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    return doc


@router.delete(
    "/prospects/{prospect_id}/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_prospect_document(
    prospect_id: UUID,
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Delete a prospect document.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    deleted = await service.delete_prospect_document(
        document_id=str(document_id),
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        deleted_by=current_user.id,
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")


# ============================================
# Election Package Endpoints
# ============================================

@router.get("/prospects/{prospect_id}/election-package", response_model=ElectionPackageResponse)
async def get_election_package(
    prospect_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    Get the election package for a prospect.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    pkg = await service.get_election_package(str(prospect_id), current_user.organization_id)
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Election package not found")
    return pkg


@router.post(
    "/prospects/{prospect_id}/election-package",
    response_model=ElectionPackageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_election_package(
    prospect_id: UUID,
    data: ElectionPackageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Create an election package for a prospect.

    This captures a snapshot of the applicant's information and prepares
    it for the election/voting process.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    pkg = await service.create_election_package(
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        pipeline_id=str(data.pipeline_id) if data.pipeline_id else None,
        step_id=str(data.step_id) if data.step_id else None,
        coordinator_notes=data.coordinator_notes,
        package_config=data.package_config,
        created_by=current_user.id,
    )
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prospect not found")
    return pkg


@router.put("/prospects/{prospect_id}/election-package", response_model=ElectionPackageResponse)
async def update_election_package(
    prospect_id: UUID,
    data: ElectionPackageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.manage", "prospective_members.manage")),
):
    """
    Update an election package for a prospect.

    **Requires permission: members.manage**
    """
    service = MembershipPipelineService(db)
    pkg = await service.update_election_package(
        prospect_id=str(prospect_id),
        organization_id=current_user.organization_id,
        updates=data.model_dump(exclude_unset=True),
        updated_by=current_user.id,
    )
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Election package not found")
    return pkg


@router.get("/election-packages", response_model=List[ElectionPackageResponse])
async def list_election_packages(
    pipeline_id: Optional[UUID] = Query(None, description="Filter by pipeline"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("members.view", "prospective_members.view", "prospective_members.manage")),
):
    """
    List election packages across all prospects, optionally filtered.

    **Requires permission: members.view**
    """
    service = MembershipPipelineService(db)
    packages = await service.list_election_packages(
        organization_id=current_user.organization_id,
        pipeline_id=str(pipeline_id) if pipeline_id else None,
        status_filter=status_filter,
    )
    return packages
