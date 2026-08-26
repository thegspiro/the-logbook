"""
Legal Documents API Endpoints

Governance -> Legal Documents. Lets the secretary and department leaders read
the wording currently published on /privacy and /terms and propose alternatives
that fit their own bylaws, SOPs, and local law; publishing is a separate grant
so proposing a revision cannot change what the public sees.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission, user_has_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.legal import (
    LegalDocumentRevision,
    LegalDocumentType,
    LegalRevisionStatus,
)
from app.models.user import User
from app.schemas.legal import (
    LegalDocumentsOverview,
    LegalDocumentState,
    LegalRevisionCreate,
    LegalRevisionResponse,
    LegalRevisionUpdate,
)
from app.services.legal_service import (
    PUBLIC_PATH,
    SETTINGS_KEY,
    LegalDocumentService,
    effective_date_for,
)

router = APIRouter()

_PUBLISH_PERMISSIONS = ("legal.publish", "settings.manage")


def _can_publish(user: User) -> bool:
    return any(user_has_permission(user, perm) for perm in _PUBLISH_PERMISSIONS)


def _to_response(
    revision: LegalDocumentRevision, names: dict[str, str]
) -> LegalRevisionResponse:
    return LegalRevisionResponse(
        id=str(revision.id),
        document_type=revision.document_type,
        status=revision.status,
        body=revision.body,
        change_note=revision.change_note,
        effective_date=revision.effective_date,
        created_by=revision.created_by,
        created_by_name=names.get(str(revision.created_by or "")),
        published_by=revision.published_by,
        published_by_name=names.get(str(revision.published_by or "")),
        published_at=revision.published_at,
        created_at=revision.created_at,
        updated_at=revision.updated_at,
    )


@router.get("", response_model=LegalDocumentsOverview)
async def get_legal_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("legal.propose", "legal.publish", "settings.manage")
    ),
):
    """
    Both public legal documents: what members see now, plus proposals and history.

    Requires: legal.propose, legal.publish or settings.manage permission.
    """
    service = LegalDocumentService(db)
    organization_id = str(current_user.organization_id)

    organization = await service.get_organization(organization_id)
    settings = organization.settings if organization else None
    legal_settings = settings.get("legal") if isinstance(settings, dict) else None
    if not isinstance(legal_settings, dict):
        legal_settings = {}

    revisions = await service.list_revisions(organization_id)
    names = await service.get_user_names(
        {str(r.created_by) for r in revisions if r.created_by}
        | {str(r.published_by) for r in revisions if r.published_by}
    )

    documents = []
    for document_type in LegalDocumentType:
        of_type = [r for r in revisions if r.document_type == document_type]
        published = next(
            (r for r in of_type if r.status == LegalRevisionStatus.PUBLISHED), None
        )
        # The settings value — not this table — is what the public page serves,
        # so it decides whether the platform default is live. Text configured
        # before this screen existed, or edited directly in settings, has no
        # revision row but is still what members read.
        live_body = legal_settings.get(SETTINGS_KEY[document_type])
        live_body = (
            live_body if isinstance(live_body, str) and live_body.strip() else None
        )
        documents.append(
            LegalDocumentState(
                document_type=document_type,
                public_path=PUBLIC_PATH[document_type],
                using_platform_default=live_body is None,
                published_body=live_body,
                published_effective_date=(
                    effective_date_for(legal_settings, document_type)
                    if live_body
                    else None
                ),
                published_at=published.published_at if published else None,
                published_by_name=(
                    names.get(str(published.published_by or "")) if published else None
                ),
                drafts=[
                    _to_response(r, names)
                    for r in of_type
                    if r.status == LegalRevisionStatus.DRAFT
                ],
                history=[
                    _to_response(r, names)
                    for r in of_type
                    if r.status != LegalRevisionStatus.DRAFT
                ],
            )
        )

    return LegalDocumentsOverview(
        organization_name=organization.name if organization else None,
        can_publish=_can_publish(current_user),
        documents=documents,
    )


@router.post("/revisions", response_model=LegalRevisionResponse, status_code=201)
async def create_revision(
    payload: LegalRevisionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("legal.propose", "legal.publish", "settings.manage")
    ),
):
    """
    Propose a revision to a public legal document. Saved as a draft, not published.

    Requires: legal.propose, legal.publish or settings.manage permission.
    """
    service = LegalDocumentService(db)
    try:
        revision = await service.create_draft(
            organization_id=str(current_user.organization_id),
            created_by=str(current_user.id),
            document_type=payload.document_type,
            body=payload.body,
            change_note=payload.change_note,
            effective_date=payload.effective_date,
        )
        await log_audit_event(
            db=db,
            event_type="legal.revision_proposed",
            event_category="administration",
            severity="info",
            event_data={
                "document_type": payload.document_type.value,
                "revision_id": str(revision.id),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        await db.commit()
        await db.refresh(revision)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    names = await service.get_user_names({str(current_user.id)})
    return _to_response(revision, names)


@router.put("/revisions/{revision_id}", response_model=LegalRevisionResponse)
async def update_revision(
    revision_id: str,
    payload: LegalRevisionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("legal.propose", "legal.publish", "settings.manage")
    ),
):
    """
    Edit a draft revision. Published and archived revisions are immutable.

    Requires: legal.propose, legal.publish or settings.manage permission.
    """
    service = LegalDocumentService(db)
    organization_id = str(current_user.organization_id)
    try:
        existing = await service.get_revision(revision_id, organization_id)
        _assert_may_modify(existing, current_user)
        revision = await service.update_draft(
            revision_id=revision_id,
            organization_id=organization_id,
            updates=payload.model_dump(exclude_unset=True),
        )
        await db.commit()
        await db.refresh(revision)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=_status_for(e), detail=safe_error_detail(e))
    names = await service.get_user_names(
        {str(revision.created_by or ""), str(revision.published_by or "")}
    )
    return _to_response(revision, names)


@router.delete("/revisions/{revision_id}", status_code=204)
async def delete_revision(
    revision_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("legal.propose", "legal.publish", "settings.manage")
    ),
):
    """
    Discard a draft revision. Published and archived revisions are kept.

    Requires: legal.propose, legal.publish or settings.manage permission.
    """
    service = LegalDocumentService(db)
    organization_id = str(current_user.organization_id)
    try:
        existing = await service.get_revision(revision_id, organization_id)
        _assert_may_modify(existing, current_user)
        await service.delete_draft(revision_id, organization_id)
        await db.commit()
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=_status_for(e), detail=safe_error_detail(e))
    return None


@router.post("/revisions/{revision_id}/publish", response_model=LegalRevisionResponse)
async def publish_revision(
    revision_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("legal.publish", "settings.manage")
    ),
):
    """
    Publish a draft to its public page, archiving whatever was published before.

    Requires: legal.publish or settings.manage permission.
    """
    service = LegalDocumentService(db)
    try:
        revision = await service.publish(
            revision_id=revision_id,
            organization_id=str(current_user.organization_id),
            published_by=str(current_user.id),
        )
        await log_audit_event(
            db=db,
            event_type="legal.document_published",
            event_category="administration",
            severity="warning",
            event_data={
                "document_type": revision.document_type.value,
                "revision_id": str(revision.id),
                "public_path": PUBLIC_PATH[revision.document_type],
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        await db.commit()
        await db.refresh(revision)
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=_status_for(e), detail=safe_error_detail(e))
    names = await service.get_user_names(
        {str(revision.created_by or ""), str(revision.published_by or "")}
    )
    return _to_response(revision, names)


@router.post("/{document_type}/revert-to-default", status_code=204)
async def revert_to_default(
    document_type: LegalDocumentType,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("legal.publish", "settings.manage")
    ),
):
    """
    Remove the department's published text so the built-in default is shown again.

    Requires: legal.publish or settings.manage permission.
    """
    service = LegalDocumentService(db)
    try:
        await service.revert_to_default(
            organization_id=str(current_user.organization_id),
            document_type=document_type,
        )
        await log_audit_event(
            db=db,
            event_type="legal.document_reverted_to_default",
            event_category="administration",
            severity="warning",
            event_data={"document_type": document_type.value},
            user_id=str(current_user.id),
            username=current_user.username,
        )
        await db.commit()
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=_status_for(e), detail=safe_error_detail(e))
    return None


def _assert_may_modify(revision: LegalDocumentRevision, user: User) -> None:
    """A proposer owns their own draft; publishers may tidy up anyone's.

    Without this any leader could rewrite a colleague's proposal and leave their
    name on it, which is the one thing a proposal record exists to prevent.
    """
    if _can_publish(user):
        return
    if str(revision.created_by or "") != str(user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only change revisions you proposed",
        )


def _status_for(error: ValueError) -> int:
    return 404 if "not found" in str(error).lower() else 400
