"""
Forms API Endpoints

Endpoints for custom forms including form definitions, fields,
submissions, and reporting.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.core.database import get_db
from app.models.user import User
from app.models.forms import FormStatus, FormCategory
from app.schemas.forms import (
    # Form schemas
    FormCreate,
    FormUpdate,
    FormResponse,
    FormDetailResponse,
    FormsListResponse,
    # Field schemas
    FormFieldCreate,
    FormFieldUpdate,
    FormFieldResponse,
    # Submission schemas
    FormSubmissionCreate,
    FormSubmissionResponse,
    SubmissionsListResponse,
    # Summary
    FormsSummary,
)
from app.services.forms_service import FormsService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


# ============================================
# Form Endpoints
# ============================================

@router.get("/", response_model=FormsListResponse)
async def list_forms(
    status: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    is_template: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.view")),
):
    """
    List all forms for the organization

    **Authentication required**
    **Requires permission: forms.view**
    """
    service = FormsService(db)

    status_enum = None
    if status:
        try:
            status_enum = FormStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status}",
            )

    category_enum = None
    if category:
        try:
            category_enum = FormCategory(category)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category: {category}",
            )

    forms, total = await service.get_forms(
        organization_id=current_user.organization_id,
        status=status_enum,
        category=category_enum,
        search=search,
        is_template=is_template,
        skip=skip,
        limit=limit,
    )

    # Enrich with counts
    form_responses = []
    for form in forms:
        resp = FormResponse.model_validate(form)
        resp.field_count = len(form.fields) if form.fields else 0
        form_responses.append(resp)

    return FormsListResponse(
        forms=form_responses,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/", response_model=FormDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_form(
    form_data: FormCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Create a new form

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    new_form, error = await service.create_form(
        organization_id=current_user.organization_id,
        form_data=form_data.model_dump(exclude_unset=True),
        created_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return new_form


@router.get("/summary", response_model=FormsSummary)
async def get_forms_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.view")),
):
    """
    Get forms summary statistics

    **Authentication required**
    **Requires permission: forms.view**
    """
    service = FormsService(db)
    summary = await service.get_summary(
        organization_id=current_user.organization_id,
    )
    return summary


@router.get("/{form_id}", response_model=FormDetailResponse)
async def get_form(
    form_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.view")),
):
    """
    Get a specific form by ID with all fields

    **Authentication required**
    **Requires permission: forms.view**
    """
    service = FormsService(db)
    form = await service.get_form_by_id(
        form_id=form_id,
        organization_id=current_user.organization_id,
    )

    if not form:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form not found",
        )

    return form


@router.patch("/{form_id}", response_model=FormDetailResponse)
async def update_form(
    form_id: UUID,
    update_data: FormUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Update a form

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    updated_form, error = await service.update_form(
        form_id=form_id,
        organization_id=current_user.organization_id,
        update_data=update_data.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return updated_form


@router.delete("/{form_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_form(
    form_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Delete a form and all its fields/submissions

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    success, error = await service.delete_form(
        form_id=form_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )


@router.post("/{form_id}/publish", response_model=FormDetailResponse)
async def publish_form(
    form_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Publish a form (make it available for submissions)

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    form, error = await service.publish_form(
        form_id=form_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return form


@router.post("/{form_id}/archive", response_model=FormDetailResponse)
async def archive_form(
    form_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Archive a form

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    form, error = await service.archive_form(
        form_id=form_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return form


# ============================================
# Field Endpoints
# ============================================

@router.post("/{form_id}/fields", response_model=FormFieldResponse, status_code=status.HTTP_201_CREATED)
async def add_field(
    form_id: UUID,
    field_data: FormFieldCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Add a field to a form

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    field, error = await service.add_field(
        form_id=form_id,
        organization_id=current_user.organization_id,
        field_data=field_data.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return field


@router.patch("/{form_id}/fields/{field_id}", response_model=FormFieldResponse)
async def update_field(
    form_id: UUID,
    field_id: UUID,
    update_data: FormFieldUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Update a form field

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    field, error = await service.update_field(
        field_id=field_id,
        form_id=form_id,
        organization_id=current_user.organization_id,
        update_data=update_data.model_dump(exclude_unset=True),
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return field


@router.delete("/{form_id}/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_field(
    form_id: UUID,
    field_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Delete a form field

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    success, error = await service.delete_field(
        field_id=field_id,
        form_id=form_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )


@router.post("/{form_id}/fields/reorder", status_code=status.HTTP_200_OK)
async def reorder_fields(
    form_id: UUID,
    field_order: List[str],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Reorder fields in a form

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    success, error = await service.reorder_fields(
        form_id=form_id,
        organization_id=current_user.organization_id,
        field_order=field_order,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return {"message": "Fields reordered successfully"}


# ============================================
# Submission Endpoints
# ============================================

@router.post("/{form_id}/submit", response_model=FormSubmissionResponse, status_code=status.HTTP_201_CREATED)
async def submit_form(
    form_id: UUID,
    submission: FormSubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit a form

    **Authentication required**
    Any authenticated user can submit a form.
    """
    service = FormsService(db)
    result, error = await service.submit_form(
        form_id=form_id,
        organization_id=current_user.organization_id,
        data=submission.data,
        submitted_by=current_user.id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    return result


@router.get("/{form_id}/submissions", response_model=SubmissionsListResponse)
async def list_submissions(
    form_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    List submissions for a form

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    submissions, total = await service.get_submissions(
        form_id=form_id,
        organization_id=current_user.organization_id,
        skip=skip,
        limit=limit,
    )

    return SubmissionsListResponse(
        submissions=submissions,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/{form_id}/submissions/{submission_id}", response_model=FormSubmissionResponse)
async def get_submission(
    form_id: UUID,
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Get a specific submission

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    submission = await service.get_submission_by_id(
        submission_id=submission_id,
        organization_id=current_user.organization_id,
    )

    if not submission:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Submission not found",
        )

    return submission


@router.delete("/{form_id}/submissions/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_submission(
    form_id: UUID,
    submission_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("forms.manage")),
):
    """
    Delete a submission

    **Authentication required**
    **Requires permission: forms.manage**
    """
    service = FormsService(db)
    success, error = await service.delete_submission(
        submission_id=submission_id,
        organization_id=current_user.organization_id,
    )

    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )
