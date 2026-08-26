"""
Documents API Endpoints

Endpoints for document management including folders,
document CRUD, and file uploads.
"""

import asyncio
import os
import uuid as uuid_lib
from typing import Optional
from uuid import UUID

import magic
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.core.utils import ensure_found, handle_service_errors, safe_error_detail
from app.models.document import Document, DocumentStatus
from app.models.user import User
from app.schemas.documents import (
    DocumentFolderCreate,
    DocumentFolderResponse,
    DocumentFolderUpdate,
    DocumentResponse,
    DocumentsListResponse,
    DocumentsSummary,
    DocumentUpdate,
    FoldersListResponse,
)
from app.services.documents_service import DocumentsService

router = APIRouter()

UPLOAD_DIR = "/app/uploads/documents"


def _parse_uuid_or_400(value: str, field: str) -> UUID:
    """Parse a client-supplied UUID string, or raise a clean 400.

    ``UUID(value)`` raises ``ValueError`` on anything malformed, and letting
    that escape unhandled becomes an unhandled 500 instead of a 4xx — hit in
    practice by the upload form's own placeholder value ("general") sent as
    ``folder_id`` when an organization has no folders yet.
    """
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid {field}")


def _resolve_document_name(name: Optional[str], filename: Optional[str]) -> str:
    """The document's display name: the caller's, or derived from the file.

    The upload form advertises the name field as "Optional - defaults to file
    name" and omits it entirely when left blank, so a required ``Form(...)``
    here 422'd on that exact, normal path.
    """
    stripped = (name or "").strip()
    if stripped:
        return stripped
    return filename or "Untitled document"


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
    parent_id: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List document folders the current user can access"""
    service = DocumentsService(db)
    parent_uuid = _parse_uuid_or_400(parent_id, "parent_id") if parent_id else None
    folders = await service.get_folders(
        current_user.organization_id, parent_uuid, current_user=current_user
    )

    return {
        "folders": [
            {
                **{c.key: getattr(f, c.key) for c in f.__table__.columns},
                "document_count": getattr(f, "document_count", 0),
            }
            for f in folders
        ],
        "total": len(folders),
    }


@router.post(
    "/folders",
    response_model=DocumentFolderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    folder: DocumentFolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Create a new document folder"""
    service = DocumentsService(db)
    folder_data = folder.model_dump(exclude_none=True)
    async with handle_service_errors("Unable to create folder"):
        result = await service.create_folder(
            current_user.organization_id, folder_data, current_user.id
        )
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
    # exclude_unset, not exclude_none: this is an update payload, so an
    # explicit null (clearing parent_id/owner_user_id) must survive to the
    # service as "clear this field", not be dropped as if never sent
    # (CLAUDE.md pitfall #1's update-path mirror image).
    update_data = folder.model_dump(exclude_unset=True)
    # Wrapped so a service-layer ValueError (an out-of-org parent/owner id,
    # DOC-6, or a cyclic parent) returns 400 rather than 500, matching
    # create_folder.
    async with handle_service_errors("Unable to update folder"):
        updated = await service.update_folder(
            folder_id, current_user.organization_id, update_data
        )
    result = ensure_found(updated, "Folder")
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
    folder_id: str | None = None,
    search: str | None = None,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List documents with optional filtering and folder access control"""
    service = DocumentsService(db)
    folder_uuid = _parse_uuid_or_400(folder_id, "folder_id") if folder_id else None

    # Enforce folder-level access when listing by folder
    if folder_uuid:
        folder = ensure_found(
            await service.get_folder_by_id(folder_uuid, current_user.organization_id),
            "Folder",
        )
        if not service.can_access_folder(folder, current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this folder",
            )

    # Restrict the listing to folders the caller may access (None = leadership,
    # no restriction) so a folder-less listing can't surface documents from
    # restricted/owner-only folders.
    accessible = await service.accessible_folder_ids(
        current_user.organization_id, current_user
    )
    documents, total = await service.get_documents(
        current_user.organization_id,
        folder_id=folder_uuid,
        search=search,
        skip=pagination.skip,
        limit=pagination.limit,
        accessible_folder_ids=accessible,
    )
    # Fill in the uploader/folder names the response declares (else the
    # "Uploaded by …" attribution never renders).
    await service.attach_document_names(current_user.organization_id, list(documents))

    return {
        "documents": documents,
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
    }


@router.post(
    "/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED
)
async def upload_document(
    file: UploadFile = File(...),
    name: str = Form(None),
    description: str = Form(None),
    folder_id: str = Form(None),
    tags: str = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Upload a new document (with folder access control).

    ``name`` is optional — the upload form itself advertises "Optional -
    defaults to file name" and omits the field entirely when left blank, so
    a required ``Form(...)`` here 422'd on that exact, normal path. Falls back
    to the uploaded filename, matching what the UI promises.
    """
    service = DocumentsService(db)
    name = _resolve_document_name(name, file.filename)

    # Enforce folder access if uploading into a specific folder
    if folder_id:
        folder = await service.get_folder_by_id(
            _parse_uuid_or_400(folder_id, "folder_id"), current_user.organization_id
        )
        # Fail closed: a nonexistent or out-of-org folder must be rejected, not
        # silently accepted (which previously stored an unvalidated folder_id).
        if folder is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found"
            )
        if not service.can_access_folder(folder, current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to upload to this folder",
            )

    # Validate file size (50MB max)
    max_size = 50 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        raise CodedHTTPException(
            status_code=400,
            detail="File too large. Maximum size is 50MB.",
            error_code=ErrorCode.UPLD_TOO_LARGE,
        )

    # Validate MIME type using magic bytes (not the HTTP Content-Type header)
    detected_mime = magic.from_buffer(content[:2048], mime=True)
    if detected_mime not in ALLOWED_DOCUMENT_MIME_TYPES:
        logger.warning(
            f"Document upload rejected: detected MIME type '{detected_mime}' "
            f"(claimed: '{file.content_type}') for file '{file.filename}'"
        )
        raise CodedHTTPException(
            status_code=400,
            detail=f"File type not allowed. Detected type: {detected_mime}. "
            "Allowed types: PDF, Word, Excel, PowerPoint, text, CSV, images, ZIP.",
            error_code=ErrorCode.UPLD_TYPE_NOT_ALLOWED,
        )

    # Create upload directory
    org_dir = os.path.join(UPLOAD_DIR, str(current_user.organization_id))
    await asyncio.to_thread(os.makedirs, org_dir, exist_ok=True)

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
    ext = MIME_TO_EXT.get(detected_mime)
    if not ext:
        # Fallback to safe default — never use user-supplied filename extension
        # to prevent double-extension attacks (e.g. report.pdf.exe)
        logger.warning(
            f"No extension mapping for MIME type '{detected_mime}'; "
            f"using .bin fallback (filename: '{file.filename}')"
        )
        ext = ".bin"
    unique_name = f"{uuid_lib.uuid4().hex}{ext}"
    file_path = os.path.join(org_dir, unique_name)

    # Save file
    def _write_file(path: str, data: bytes) -> None:
        with open(path, "wb") as f:
            f.write(data)

    await asyncio.to_thread(_write_file, file_path, content)

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
            logger.warning(
                f"Failed to clean up file after document creation error: {file_path}"
            )
        logger.error(f"Failed to create document record: {e}")
        raise HTTPException(
            status_code=400, detail=safe_error_detail(e, "Unable to save document")
        )

    await log_audit_event(
        db=db,
        event_type="document_uploaded",
        event_category="documents",
        severity="info",
        event_data={
            "document_name": name,
            "file_type": detected_mime,
            "file_size": len(content),
            "folder_id": folder_id,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await service.attach_document_names(current_user.organization_id, [document])
    return document


# Declared above the catch-all `/{document_id}` on purpose: FastAPI
# matches in declaration order, so below it `/my-folder` resolved as an id
# and the endpoint was unreachable.
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
    folder = await service.ensure_member_folder(
        current_user.organization_id, current_user
    )
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


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """Get a document by ID"""
    service = DocumentsService(db)
    document = ensure_found(
        await service.get_document_by_id(document_id, current_user.organization_id),
        "Document",
    )
    # The list view hides documents in restricted folders (leadership-only,
    # owner-only personal files, role-restricted); a direct by-id fetch must
    # enforce the same boundary. Treat an inaccessible document as not found so
    # its existence isn't revealed to someone guessing ids.
    if not await service.can_access_document(
        document, current_user.organization_id, current_user
    ):
        raise HTTPException(status_code=404, detail="Document not found")
    await service.attach_document_names(current_user.organization_id, [document])
    return document


@router.get("/{document_id}/download")
async def download_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """Download a document's stored file.

    ``DocumentResponse`` intentionally excludes ``file_path``, and until this
    endpoint existed there was no way to retrieve an uploaded file's bytes at
    all — a caller could upload and delete a document but never open it
    (DOC-10 review finding, P1). Same ACL as ``GET /{document_id}``.
    """
    service = DocumentsService(db)
    document = ensure_found(
        await service.get_document_by_id(document_id, current_user.organization_id),
        "Document",
    )
    if not await service.can_access_document(
        document, current_user.organization_id, current_user
    ):
        raise HTTPException(status_code=404, detail="Document not found")

    if not document.file_path:
        raise HTTPException(status_code=404, detail="Document file not found on disk")

    # Defence-in-depth: ensure the stored path resolves inside *this org's*
    # own upload directory before serving it, in case the DB value is ever
    # tampered with. Scoped to the org subdirectory, not the shared
    # UPLOAD_DIR root: every org's files live under UPLOAD_DIR, so a
    # tampered file_path pointing at another org's subdirectory would still
    # pass a root-level check and leak that org's document (Codex finding).
    resolved_path = os.path.realpath(document.file_path)
    allowed_base = os.path.realpath(
        os.path.join(UPLOAD_DIR, str(current_user.organization_id))
    )
    if (
        not resolved_path.startswith(allowed_base + os.sep)
        and resolved_path != allowed_base
    ):
        logger.warning(
            f"Path traversal attempt blocked for document {document_id}: "
            f"{document.file_path} resolved to {resolved_path}"
        )
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(resolved_path):
        raise HTTPException(status_code=404, detail="Document file not found on disk")

    return FileResponse(
        path=resolved_path,
        filename=document.file_name or document.name or "download",
        media_type=document.file_type or "application/octet-stream",
    )


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: UUID,
    doc: DocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Update a document's metadata"""
    service = DocumentsService(db)
    # exclude_unset, not exclude_none: an explicit null (clearing folder_id to
    # move a document to org level) must reach the service as a clear, not be
    # silently dropped (CLAUDE.md pitfall #1's update-path mirror image).
    update_data = doc.model_dump(exclude_unset=True)
    # Wrapped so a service-layer ValueError (an out-of-org folder_id, DOC-6)
    # returns 400 rather than 500.
    async with handle_service_errors("Unable to update document"):
        updated = await service.update_document(
            document_id, current_user.organization_id, update_data
        )
    result = ensure_found(updated, "Document")
    await service.attach_document_names(current_user.organization_id, [result])
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
    await log_audit_event(
        db=db,
        event_type="document_deleted",
        event_category="documents",
        severity="warning",
        event_data={"document_id": str(document_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )


# ============================================
# Member Folder Endpoints
# ============================================


@router.get("/stats/summary", response_model=DocumentsSummary)
async def get_documents_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """Get documents module summary statistics"""
    service = DocumentsService(db)
    return await service.get_summary(current_user.organization_id)
