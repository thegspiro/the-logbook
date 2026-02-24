"""
Documents API Endpoints

Endpoints for document management including folders,
document CRUD, and file uploads.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
import os
import uuid as uuid_lib
import logging
import magic

from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.models.document import Document, DocumentStatus
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

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOAD_DIR = "/app/uploads/documents"

# Allowed MIME types for document uploads (validated via magic bytes, not HTTP headers)
ALLOWED_DOCUMENT_MIME_TYPES = {
    # Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    # Images
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    # Archives
    "application/zip",
    "application/x-zip-compressed",
}


# ============================================
# Folder Endpoints
# ============================================

@router.get("/folders", response_model=FoldersListResponse)
async def list_folders(
    parent_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List document folders the current user can access"""
    service = DocumentsService(db)
    parent_uuid = UUID(parent_id) if parent_id else None
    folders = await service.get_folders(
        current_user.organization_id, parent_uuid, current_user=current_user
    )

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
    try:
        result = await service.create_folder(
            current_user.organization_id, folder_data, current_user.id
        )
    except Exception as e:
        logger.error(f"Failed to create folder: {e}")
        raise HTTPException(status_code=400, detail=safe_error_detail(e, "Unable to create folder"))
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
    result = await service.update_folder(
        folder_id, current_user.organization_id, update_data
    )
    if not result:
        raise HTTPException(status_code=404, detail="Folder not found")
    return result


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Delete a document folder and all its documents"""
    service = DocumentsService(db)
    success = await service.delete_folder(folder_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=404, detail="Folder not found")


# ============================================
# Document Endpoints
# ============================================

@router.get("", response_model=DocumentsListResponse)
async def list_documents(
    folder_id: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List documents with optional filtering and folder access control"""
    service = DocumentsService(db)
    folder_uuid = UUID(folder_id) if folder_id else None

    # Enforce folder-level access when listing by folder
    if folder_uuid:
        folder = await service.get_folder_by_id(folder_uuid, current_user.organization_id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not service.can_access_folder(folder, current_user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this folder")

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
    """Upload a new document (with folder access control)"""
    service = DocumentsService(db)

    # Enforce folder access if uploading into a specific folder
    if folder_id:
        folder = await service.get_folder_by_id(UUID(folder_id), current_user.organization_id)
        if folder and not service.can_access_folder(folder, current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to upload to this folder",
            )

    # Validate file size (50MB max)
    max_size = 50 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 50MB."
        )

    # Validate MIME type using magic bytes (not the HTTP Content-Type header)
    detected_mime = magic.from_buffer(content[:2048], mime=True)
    if detected_mime not in ALLOWED_DOCUMENT_MIME_TYPES:
        logger.warning(
            f"Document upload rejected: detected MIME type '{detected_mime}' "
            f"(claimed: '{file.content_type}') for file '{file.filename}'"
        )
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Detected type: {detected_mime}. "
                   "Allowed types: PDF, Word, Excel, PowerPoint, text, CSV, images, ZIP."
        )

    # Create upload directory
    org_dir = os.path.join(UPLOAD_DIR, str(current_user.organization_id))
    os.makedirs(org_dir, exist_ok=True)

    # Derive file extension from detected MIME type (not user-supplied filename)
    # to prevent double-extension attacks (e.g. report.pdf.exe)
    MIME_TO_EXT = {
        "application/pdf": ".pdf",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.ms-powerpoint": ".ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "text/plain": ".txt",
        "text/csv": ".csv",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "application/zip": ".zip",
    }
    ext = MIME_TO_EXT.get(detected_mime, os.path.splitext(file.filename or "")[1])
    unique_name = f"{uuid_lib.uuid4().hex}{ext}"
    file_path = os.path.join(org_dir, unique_name)

    # Save file
    with open(file_path, "wb") as f:
        f.write(content)

    # Create document record
    doc_data = {
        "name": name,
        "description": description,
        "folder_id": folder_id if folder_id else None,
        "file_name": file.filename or unique_name,
        "file_path": file_path,
        "file_size": len(content),
        "file_type": detected_mime,
        "tags": tags,
    }

    try:
        document = await service.create_document(
            current_user.organization_id, doc_data, current_user.id
        )
    except Exception as e:
        # Clean up file on error
        try:
            os.remove(file_path)
        except OSError:
            logger.warning(f"Failed to clean up file after document creation error: {file_path}")
        logger.error(f"Failed to create document record: {e}")
        raise HTTPException(status_code=400, detail=safe_error_detail(e, "Unable to save document"))

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
    result = await service.update_document(
        document_id, current_user.organization_id, update_data
    )
    if not result:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Delete a document"""
    service = DocumentsService(db)
    success = await service.delete_document(document_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found")


# ============================================
# Member Folder Endpoints
# ============================================

@router.get("/my-folder", response_model=DocumentFolderResponse)
async def get_my_member_folder(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """
    Get (or auto-create) the current user's personal folder
    under the 'Member Files' hierarchy.
    """
    service = DocumentsService(db)
    folder = await service.ensure_member_folder(current_user.organization_id, current_user)
    await db.commit()

    count_result = await db.execute(
        select(func.count(Document.id))
        .where(Document.folder_id == folder.id)
        .where(Document.status == DocumentStatus.ACTIVE)
    )
    folder.document_count = count_result.scalar() or 0

    return {
        **{c.key: getattr(folder, c.key) for c in folder.__table__.columns},
        "document_count": folder.document_count,
    }


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
