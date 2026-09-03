"""Documents: the department library, published and unrestricted only."""

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.registry import logbook_tool
from app.mcp.tools._common import (
    clamp_limit,
    clamp_offset,
    iso,
    org_uuid,
    page,
    parse_uuid,
)
from app.models.document import DocumentFolder, DocumentStatus, FolderVisibility
from app.services.documents_service import DocumentsService


async def _open_folder_ids(db: AsyncSession, organization_id: str) -> set[str]:
    """Folders every member can read.

    A folder that names required permissions or allowed roles, is
    leadership- or owner-only, or has an owner is a restricted folder; the
    service key is not a member and gets none of them. Documents with no
    folder are treated as open by the service layer.
    """
    rows = await db.execute(
        select(DocumentFolder).where(DocumentFolder.organization_id == organization_id)
    )
    open_ids: set[str] = set()
    for folder in rows.scalars().all():
        if folder.visibility != FolderVisibility.ORGANIZATION:
            continue
        if folder.required_permissions or folder.allowed_roles or folder.owner_user_id:
            continue
        open_ids.add(folder.id)
    return open_ids


def _document(d: Any, include_content: bool) -> dict:
    body = {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "folder_id": d.folder_id,
        "file_name": d.file_name,
        "file_type": d.file_type,
        "file_size": d.file_size,
        "document_type": iso(d.document_type),
        "status": iso(d.status),
        "source_type": iso(d.source_type),
        "version": d.version,
        "tags": d.tags,
        "created_at": iso(d.created_at),
        "updated_at": iso(d.updated_at),
    }
    if include_content:
        body["content_html"] = d.content_html
    return body


def register(server: Any) -> None:
    @logbook_tool(server, title="List documents")
    async def list_documents(
        db: AsyncSession,
        principal: McpPrincipal,
        search: Optional[str] = None,
        folder_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """Active documents in folders every member can read: name, type,
        folder, tags and version. Restricted and archived documents are not
        listed. Use get_document for the text of an in-app document."""
        limit = clamp_limit(limit)
        offset = clamp_offset(offset)
        open_ids = await _open_folder_ids(db, principal.organization_id)
        folder = parse_uuid(folder_id, "folder_id") if folder_id else None
        if folder is not None and str(folder) not in open_ids:
            raise ValueError("Folder not found")
        docs, total = await DocumentsService(db).get_documents(
            org_uuid(principal),
            folder_id=folder,
            search=search or None,
            status=DocumentStatus.ACTIVE,
            skip=offset,
            limit=limit,
            accessible_folder_ids=open_ids,
        )
        return page([_document(d, False) for d in docs], total, limit, offset)

    @logbook_tool(server, title="Get document")
    async def get_document(
        db: AsyncSession, principal: McpPrincipal, document_id: str
    ) -> dict:
        """One active document with its text when it was written in the app.
        Uploaded files return their metadata only."""
        doc = await DocumentsService(db).get_document_by_id(
            parse_uuid(document_id, "document_id"), org_uuid(principal)
        )
        if doc is None or doc.status != DocumentStatus.ACTIVE:
            raise ValueError("Document not found")
        if doc.folder_id is not None:
            open_ids = await _open_folder_ids(db, principal.organization_id)
            if doc.folder_id not in open_ids:
                raise ValueError("Document not found")
        return _document(doc, True)
