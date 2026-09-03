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
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.view")),
):
    """List document folders the current user can access"""
    service = DocumentsService(db)
    parent_uuid = _parse_uuid_or_400(parent_id, "parent_id") if parent_id else None
    folders, total = await service.get_folders(
        current_user.organization_id,
        parent_uuid,
        current_user=current_user,
        skip=pagination.skip,
        limit=pagination.limit,
    )

    return {
        "folders": [
            {
                **{c.key: getattr(f, c.key) for c in f.__table__.columns},
                "document_count": getattr(f, "document_count", 0),
            }
            for f in folders
        ],
        "total": total,
        "skip": pagination.skip,
        "limit": pagination.limit,
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
    # create_folder's DOC-6 FK validation (in the service, below) only
    # confirms a supplied parent_id belongs to the caller's organization --
    # not that the caller can access that parent, and not that they can
    # *write* to it. require_write: a read-admitting permission (e.g.
    # facilities.view_sensitive) must not authorize injecting a new folder
    # into that parent. Mirrors the destination checks upload_document and
    # update_document apply.
    parent_id = folder_data.get("parent_id")
    if parent_id:
        parent = await service.get_folder_by_id(parent_id, current_user.organization_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not await service.can_access_folder(
            parent, current_user.organization_id, current_user, require_write=True
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to create a folder here",
            )
    async with handle_service_errors("Unable to create folder"):
        result = await service.create_folder(
            current_user.organization_id, folder_data, current_user.id
        )
    await log_audit_event(
        db=db,
        event_type="folder_created",
        event_category="documents",
        severity="info",
        event_data={
            "folder_id": str(result.id),
            "name": result.name,
            "parent_id": str(result.parent_id) if result.parent_id else None,
            "visibility": result.visibility.value,
        },
        user_id=str(current_user.id),
        username=current_user.username,
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
    existing = ensure_found(
        await service.get_folder_by_id(folder_id, current_user.organization_id),
        "Folder",
    )
    # A folder's own required_permissions is the one rule documents.manage's
    # org-wide grant does not override (see _folder_admits_user). require_write:
    # a read-admitting permission (e.g. facilities.view_sensitive) must not
    # by itself authorize renaming or reparenting a sensitive-gated folder --
    # only a write-tier permission from that same list does.
    if not await service.can_access_folder(
        existing, current_user.organization_id, current_user, require_write=True
    ):
        raise HTTPException(status_code=404, detail="Folder not found")
    # exclude_unset, not exclude_none: this is an update payload, so an
    # explicit null (clearing parent_id/owner_user_id) must survive to the
    # service as "clear this field", not be dropped as if never sent
    # (CLAUDE.md pitfall #1's update-path mirror image).
    update_data = folder.model_dump(exclude_unset=True)
    # The check above authorizes only the folder's *current* ancestry.
    # DocumentsService.update_folder's DOC-6 FK validation on a reassigned
    # parent_id only confirms the new parent is in the caller's organization,
    # not that the caller can write to it. Mirrors update_document's own
    # destination check. Moving *out* to root (parent_id: null) needs no
    # destination check.
    new_parent_id = update_data.get("parent_id")
    if new_parent_id is not None and str(new_parent_id) != str(
        existing.parent_id or ""
    ):
        destination = await service.get_folder_by_id(
            new_parent_id, current_user.organization_id
        )
        if destination is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not await service.can_access_folder(
            destination, current_user.organization_id, current_user, require_write=True
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to move a folder into this parent",
            )
    # Wrapped so a service-layer ValueError (an out-of-org parent/owner id,
    # DOC-6, or a cyclic parent) returns 400 rather than 500, matching
    # create_folder.
    async with handle_service_errors("Unable to update folder"):
        updated = await service.update_folder(
            folder_id, current_user.organization_id, update_data
        )
    result = ensure_found(updated, "Folder")
    await log_audit_event(
        db=db,
        event_type="folder_updated",
        event_category="documents",
        severity="info",
        event_data={"folder_id": str(folder_id), "fields": list(update_data.keys())},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Delete a document folder and all its documents"""
    service = DocumentsService(db)
    existing = ensure_found(
        await service.get_folder_by_id(folder_id, current_user.organization_id),
        "Folder",
    )
    # Same folder-ACL boundary as update_folder above, require_write for the
    # same reason: without it a documents.manage holder holding only a
    # folder's read-tier required_permissions (e.g. facilities.view_sensitive)
    # could delete a sensitive-gated facility folder outright -- cascading to
    # every document and backing file beneath it.
    if not await service.can_access_folder(
        existing, current_user.organization_id, current_user, require_write=True
    ):
        raise HTTPException(status_code=404, detail="Folder not found")
    # A service-layer ValueError here means delete_folder's cross-organization
    # or descendant-ACL cascade guard tripped -- return 400 rather than 500.
    async with handle_service_errors("Unable to delete folder"):
        success = await service.delete_folder(
            folder_id, current_user.organization_id, current_user
        )
    if not success:
        raise HTTPException(status_code=404, detail="Folder not found")
    # A folder delete cascades to every descendant folder and document (and
    # their backing files) — the same destructive weight as document_deleted,
    # which already carries this severity.
    await log_audit_event(
        db=db,
        event_type="folder_deleted",
        event_category="documents",
        severity="warning",
        event_data={"folder_id": str(folder_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )


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
        if not await service.can_access_folder(
            folder, current_user.organization_id, current_user
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to view this folder",
            )

    # Restrict the listing to folders whose full ancestry admits the caller so
    # a folder-less listing can't surface documents from restricted trees.
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
        if not await service.can_access_folder(
            folder, current_user.organization_id, current_user
        ):
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
    (DOC-18, P1). Same ACL as ``GET /{document_id}``.
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

    # A generated document (published minutes, a property return) carries
    # content_html and no file_path at all -- there is nothing to download,
    # ever, for this row. Distinct 404 message from "file missing from disk"
    # below purely for operator log clarity; both are 404 to the client.
    if not document.file_path:
        raise HTTPException(status_code=404, detail="Document has no downloadable file")

    # Defence-in-depth: confine the resolved path to *this org's own* upload
    # subdirectory, not the shared UPLOAD_DIR root. Every org's files live
    # under UPLOAD_DIR, so a root-level containment check would still pass a
    # tampered/corrupted file_path that points at another org's subdirectory
    # and leak that org's document (DOC-24, P1). Mirrors upload_document's
    # own save-path convention (UPLOAD_DIR/<organization_id>).
    org_dir = os.path.realpath(
        os.path.join(UPLOAD_DIR, str(current_user.organization_id))
    )
    resolved_path = os.path.realpath(document.file_path)
    if resolved_path != org_dir and not resolved_path.startswith(org_dir + os.sep):
        logger.warning(
            f"Path traversal attempt blocked for document {document_id}: "
            f"{document.file_path} resolved to {resolved_path}, outside {org_dir}"
        )
        raise HTTPException(status_code=403, detail="Access denied")

    if not await asyncio.to_thread(os.path.exists, resolved_path):
        raise HTTPException(status_code=404, detail="Document file not found on disk")

    await log_audit_event(
        db=db,
        event_type="document_downloaded",
        event_category="documents",
        severity="info",
        event_data={"document_id": str(document_id)},
        user_id=str(current_user.id),
        username=current_user.username,
    )

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
    existing = ensure_found(
        await service.get_document_by_id(document_id, current_user.organization_id),
        "Document",
    )
    # documents.manage is an org-wide administrative grant, but a document's
    # containing folder can carry its own narrower ACL (required_permissions,
    # leadership/owner/role visibility) -- the same boundary can_access_document
    # already enforces on GET and download. require_write: a folder's
    # required_permissions can include a read-only entry (e.g. a facility
    # folder's facilities.view_sensitive), and that must not by itself
    # authorize moving a document out of the folder or deleting it below --
    # only a write-tier permission from that same list does.
    if not await service.can_access_document(
        existing, current_user.organization_id, current_user, require_write=True
    ):
        raise HTTPException(status_code=404, detail="Document not found")
    # exclude_unset, not exclude_none: an explicit null (clearing folder_id to
    # move a document to org level) must reach the service as a clear, not be
    # silently dropped (CLAUDE.md pitfall #1's update-path mirror image).
    update_data = doc.model_dump(exclude_unset=True)
    # The check above authorizes only the document's *current* folder. A move
    # into a new, non-null folder is a destination the caller may have no
    # write access to at all -- documents.manage authorizes moving documents
    # in general, not writing into a specific ACL-gated folder. Mirrors
    # upload_document's own destination check. Moving *out* to unfiled
    # (folder_id: null) needs no destination check -- there is no destination
    # folder to authorize.
    new_folder_id = update_data.get("folder_id")
    if new_folder_id is not None and str(new_folder_id) != str(
        existing.folder_id or ""
    ):
        destination = await service.get_folder_by_id(
            new_folder_id, current_user.organization_id
        )
        if destination is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        if not await service.can_access_folder(
            destination, current_user.organization_id, current_user, require_write=True
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to move a document into this folder",
            )
    # Wrapped so a service-layer ValueError (an out-of-org folder_id, DOC-6)
    # returns 400 rather than 500.
    async with handle_service_errors("Unable to update document"):
        updated = await service.update_document(
            document_id, current_user.organization_id, update_data
        )
    result = ensure_found(updated, "Document")
    await service.attach_document_names(current_user.organization_id, [result])
    await log_audit_event(
        db=db,
        event_type="document_updated",
        event_category="documents",
        severity="info",
        event_data={
            "document_id": str(document_id),
            "fields": list(update_data.keys()),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return result


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("documents.manage")),
):
    """Delete a document"""
    service = DocumentsService(db)
    existing = ensure_found(
        await service.get_document_by_id(document_id, current_user.organization_id),
        "Document",
    )
    # Same folder-ACL boundary as update_document above, require_write for the
    # same reason: documents.manage plus only a folder's read-tier permission
    # must not be able to destroy a document sitting in that folder.
    if not await service.can_access_document(
        existing, current_user.organization_id, current_user, require_write=True
    ):
        raise HTTPException(status_code=404, detail="Document not found")
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
    return await service.get_summary(current_user.organization_id, current_user)
