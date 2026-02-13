"""
Documents API Endpoints

Endpoints for document management including folders,
document CRUD, and file uploads.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID
import os
import uuid as uuid_lib

from app.core.database import get_db
from app.models.user import User
from app.models.document import DocumentStatus
from app.schemas.documents import (
    DocumentFolderCreate,
    DocumentFolderUpdate,
    DocumentFolderResponse,
    DocumentCreate,
    DocumentUpdate,
    DocumentResponse,
    DocumentsListResponse,
    FoldersListResponse,
    DocumentsSummary,
)
from app.services.documents_service import DocumentsService
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()

UPLOAD_DIR = "/app/uploads/documents"


# ============================================
# Folder Endpoints
# ============================================

@router.get("/folders", response_model=FoldersListResponse)
async def list_folders(
    parent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List all document folders for the organization"""
    service = DocumentsService(db)
    parent_uuid = UUID(parent_id) if parent_id else None
    folders = await service.get_folders(current_user.organization_id, parent_uuid)

    return {
        "folders": [
            {
                **{c.key: getattr(f, c.key) for c in f.__table__.columns},
                "document_count": getattr(f, 'document_count', 0),
            }
            for f in folders
        ],
        "total": len(folders),
    }


@router.post("/folders", response_model=DocumentFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_folder(
    folder: DocumentFolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Create a new document folder"""
    service = DocumentsService(db)
    folder_data = folder.model_dump(exclude_none=True)
    result, error = await service.create_folder(
        current_user.organization_id, folder_data, current_user.id
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to create folder. {error}")
    return result


@router.patch("/folders/{folder_id}", response_model=DocumentFolderResponse)
async def update_folder(
    folder_id: UUID,
    folder: DocumentFolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Update a document folder"""
    service = DocumentsService(db)
    update_data = folder.model_dump(exclude_none=True)
    result, error = await service.update_folder(
        folder_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update folder. {error}")
    return result


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Delete a document folder and all its documents"""
    service = DocumentsService(db)
    success, error = await service.delete_folder(folder_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to delete folder. {error}")


# ============================================
# Document Endpoints
# ============================================

@router.get("/", response_model=DocumentsListResponse)
async def list_documents(
    folder_id: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List documents with optional filtering"""
    service = DocumentsService(db)
    folder_uuid = UUID(folder_id) if folder_id else None
    documents, total = await service.get_documents(
        current_user.organization_id,
        folder_id=folder_uuid,
        search=search,
        skip=skip,
        limit=limit,
    )

    return {
        "documents": documents,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(None),
    folder_id: str = Form(None),
    tags: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Upload a new document"""
    # Validate file size (50MB max)
    max_size = 50 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 50MB."
        )

    # Create upload directory
    org_dir = os.path.join(UPLOAD_DIR, str(current_user.organization_id))
    os.makedirs(org_dir, exist_ok=True)

    # Generate unique filename
    ext = os.path.splitext(file.filename or "")[1]
    unique_name = f"{uuid_lib.uuid4().hex}{ext}"
    file_path = os.path.join(org_dir, unique_name)

    # Save file
    with open(file_path, "wb") as f:
        f.write(content)

    # Create document record
    service = DocumentsService(db)
    doc_data = {
        "name": name,
        "description": description,
        "folder_id": folder_id if folder_id else None,
        "file_name": file.filename or unique_name,
        "file_path": file_path,
        "file_size": len(content),
        "file_type": file.content_type,
        "tags": tags,
    }

    document, error = await service.create_document(
        current_user.organization_id, doc_data, current_user.id
    )
    if error:
        # Clean up file on error
        try:
            os.remove(file_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail=f"Unable to save document. {error}")

    return document


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """Get a document by ID"""
    service = DocumentsService(db)
    document = await service.get_document_by_id(document_id, current_user.organization_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: UUID,
    doc: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Update a document's metadata"""
    service = DocumentsService(db)
    update_data = doc.model_dump(exclude_none=True)
    result, error = await service.update_document(
        document_id, current_user.organization_id, update_data
    )
    if error:
        raise HTTPException(status_code=400, detail=f"Unable to update document. {error}")
    return result


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Delete a document"""
    service = DocumentsService(db)
    success, error = await service.delete_document(document_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=400, detail=f"Unable to delete document. {error}")


# ============================================
# Summary Endpoint
# ============================================

@router.get("/stats/summary", response_model=DocumentsSummary)
async def get_documents_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """Get documents module summary statistics"""
    service = DocumentsService(db)
    return await service.get_summary(current_user.organization_id)
