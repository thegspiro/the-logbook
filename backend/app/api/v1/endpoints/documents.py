"""
Documents API Endpoints

Endpoints for document and folder management.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.audit import log_audit_event
from app.models.user import User
from app.schemas.document import (
    FolderCreate, FolderUpdate, FolderResponse,
    DocumentCreate, DocumentUpdate, DocumentResponse, DocumentListItem,
)
from app.services.document_service import DocumentService
from app.api.dependencies import get_current_user, require_permission

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================
# Folders
# ============================================

@router.get("/folders", response_model=List[FolderResponse])
async def list_folders(
    parent_folder_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """List document folders. Auto-creates system folders on first access."""
    service = DocumentService(db)
    folders = await service.list_folders(current_user.organization_id, parent_folder_id)

    if not folders and not parent_folder_id:
        folders = await service.initialize_system_folders(current_user.organization_id, current_user.id)

    result = []
    for f in folders:
        count = await service.get_folder_document_count(f.id, current_user.organization_id)
        result.append(FolderResponse(
            id=f.id,
            organization_id=f.organization_id,
            name=f.name,
            slug=f.slug,
            description=f.description,
            parent_folder_id=f.parent_folder_id,
            sort_order=f.sort_order,
            is_system=f.is_system,
            icon=f.icon,
            color=f.color,
            document_count=count,
            created_at=f.created_at,
            updated_at=f.updated_at,
        ))
    return result


@router.post("/folders", response_model=FolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    data: FolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Create a custom document folder"""
    service = DocumentService(db)
    folder = await service.create_folder(data, current_user.organization_id, current_user.id)

    await log_audit_event(
        db=db, event_type="folder_created", event_category="documents", severity="info",
        event_data={"folder_id": folder.id, "name": folder.name},
        user_id=str(current_user.id),
    )

    count = await service.get_folder_document_count(folder.id, current_user.organization_id)
    return FolderResponse(
        id=folder.id, organization_id=folder.organization_id, name=folder.name,
        slug=folder.slug, description=folder.description,
        parent_folder_id=folder.parent_folder_id, sort_order=folder.sort_order,
        is_system=folder.is_system, icon=folder.icon, color=folder.color,
        document_count=count, created_at=folder.created_at, updated_at=folder.updated_at,
    )


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Delete a custom folder (system folders cannot be deleted)"""
    service = DocumentService(db)
    deleted = await service.delete_folder(folder_id, current_user.organization_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Folder not found or is a system folder")


# ============================================
# Documents
# ============================================

@router.get("", response_model=List[DocumentListItem])
async def list_documents(
    folder_id: Optional[str] = None,
    document_type: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """List documents with optional filtering"""
    service = DocumentService(db)
    docs = await service.list_documents(
        organization_id=current_user.organization_id,
        folder_id=folder_id, document_type=document_type,
        search=search, skip=skip, limit=min(limit, 100),
    )
    return [
        DocumentListItem(
            id=d.id, folder_id=d.folder_id, title=d.title, description=d.description,
            document_type=d.document_type if isinstance(d.document_type, str) else d.document_type.value,
            file_name=d.file_name, file_size=d.file_size, mime_type=d.mime_type,
            source_type=d.source_type, tags=d.tags,
            created_by=d.created_by, created_at=d.created_at,
        )
        for d in docs
    ]


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.view")),
):
    """Get a document by ID (includes content_html for generated docs)"""
    service = DocumentService(db)
    doc = await service.get_document(document_id, current_user.organization_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return DocumentResponse(
        id=doc.id, organization_id=doc.organization_id, folder_id=doc.folder_id,
        title=doc.title, description=doc.description,
        document_type=doc.document_type if isinstance(doc.document_type, str) else doc.document_type.value,
        file_path=doc.file_path, file_name=doc.file_name, file_size=doc.file_size,
        mime_type=doc.mime_type, content_html=doc.content_html,
        source_type=doc.source_type, source_id=doc.source_id, tags=doc.tags,
        created_by=doc.created_by, created_at=doc.created_at, updated_at=doc.updated_at,
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("meetings.manage")),
):
    """Delete a document"""
    service = DocumentService(db)
    deleted = await service.delete_document(document_id, current_user.organization_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    await log_audit_event(
        db=db, event_type="document_deleted", event_category="documents", severity="warning",
        event_data={"document_id": document_id},
        user_id=str(current_user.id),
    )
