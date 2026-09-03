"""Documents: the department library, published and unrestricted only."""

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.principal import McpPrincipal
from app.mcp.redaction import scrub_text
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

# Characters of a document's text, or of its description, returned per
# call. An in-app document is a LONGTEXT column and the description is
# unbounded Text; a client reads a long one in pieces rather than having
# the whole thing scanned, redacted and serialized at once.
DOCUMENT_CONTENT_CHARS = 20_000


def _clip(value: Any) -> tuple[Any, bool]:
    """``value`` scrubbed and cut to ``DOCUMENT_CONTENT_CHARS``, and whether cut."""
    if not isinstance(value, str):
        return value, False
    value = scrub_text(value)
    if len(value) <= DOCUMENT_CONTENT_CHARS:
        return value, False
    return value[:DOCUMENT_CONTENT_CHARS], True


def _chunk(text: str, offset: int) -> dict:
    # Scrubbed before it is cut, so a number or address that would straddle
    # a boundary can never be reassembled from two pieces.
    text = scrub_text(text)
    piece = text[offset : offset + DOCUMENT_CONTENT_CHARS]
    body = {
        "content": piece,
        "content_offset": offset,
        "content_total_chars": len(text),
        "content_has_more": offset + len(piece) < len(text),
    }
    if body["content_has_more"]:
        body["next_content_offset"] = offset + len(piece)
    return body


def _folder_is_open(folder: DocumentFolder) -> bool:
    """A folder every member can read, judged on its own settings only."""
    if folder.visibility != FolderVisibility.ORGANIZATION:
        return False
    return not (
        folder.required_permissions or folder.allowed_roles or folder.owner_user_id
    )


async def _open_folder_ids(db: AsyncSession, organization_id: str) -> set[str]:
    """Folders every member can read, judged with their whole ancestry.

    Restrictions compose with AND down the tree, the way
    ``DocumentsService.can_access_folder`` evaluates them: a folder is open
    only if it and every ancestor is organization-visible with no required
    permissions, allowed roles or owner. A missing ancestor or a cycle fails
    closed. The service key is not a member and gets no leadership bypass.
    Documents with no folder are treated as open by the service layer.
    """
    rows = await db.execute(
        select(DocumentFolder).where(DocumentFolder.organization_id == organization_id)
    )
    by_id = {f.id: f for f in rows.scalars().all()}
    open_ids: set[str] = set()
    for folder in by_id.values():
        current: Optional[DocumentFolder] = folder
        seen: set[str] = set()
        admitted = False
        while current is not None:
            if current.id in seen or not _folder_is_open(current):
                break
            seen.add(current.id)
            if current.parent_id is None:
                admitted = True
                break
            current = by_id.get(current.parent_id)
        if admitted:
            open_ids.add(folder.id)
    return open_ids


async def _visible_document(
    db: AsyncSession, principal: McpPrincipal, document_id: str
) -> Any:
    """The document by id, under the same rules as ``get_document``."""
    doc = await DocumentsService(db).get_document_by_id(
        parse_uuid(document_id, "document_id"), org_uuid(principal)
    )
    if doc is None or doc.status != DocumentStatus.ACTIVE:
        raise ValueError("Document not found")
    # A generated document (a property-return report, filed minutes)
    # embeds structured member data — an address, a membership number, a
    # separation reason — that a text scrub cannot recognise. Only what a
    # person uploaded or wrote in the app is available here.
    if doc.source_type is not None:
        raise ValueError("Document not found")
    if doc.folder_id is not None:
        open_ids = await _open_folder_ids(db, principal.organization_id)
        if doc.folder_id not in open_ids:
            raise ValueError("Document not found")
    return doc


def _document(d: Any, include_content: bool, content_offset: int = 0) -> dict:
    description, cut = _clip(d.description)
    body = {
        "id": d.id,
        "name": d.name,
        "description": description,
        "description_truncated": cut,
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
        chunk = _chunk(d.content_html or "", content_offset)
        body["content_html"] = chunk.pop("content")
        body.update(chunk)
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
        listed. A description is cut at 20,000 characters
        (``description_truncated``); ``get_document_description`` reads the
        rest. Use get_document for the text of an in-app document."""
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
            defer_content=True,
            human_authored_only=True,
        )
        return page([_document(d, False) for d in docs], total, limit, offset)

    @logbook_tool(server, title="Get document")
    async def get_document(
        db: AsyncSession,
        principal: McpPrincipal,
        document_id: str,
        content_offset: int = 0,
    ) -> dict:
        """One active document with its text when it was written in the app.
        Uploaded files return their metadata only. Text is returned in
        pieces of at most 20,000 characters: when ``content_has_more`` is
        true, call again with ``content_offset`` set to
        ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        doc = await _visible_document(db, principal, document_id)
        return _document(doc, True, content_offset)

    @logbook_tool(server, title="Read document description")
    async def get_document_description(
        db: AsyncSession,
        principal: McpPrincipal,
        document_id: str,
        content_offset: int = 0,
    ) -> dict:
        """A document's description, 20,000 characters at a time, under the
        same rules as ``get_document``. When ``content_has_more`` is true,
        call again with ``content_offset`` set to ``next_content_offset``."""
        content_offset = clamp_offset(content_offset)
        doc = await _visible_document(db, principal, document_id)
        body = {"document_id": doc.id, "name": doc.name}
        body.update(_chunk(doc.description or "", content_offset))
        return body
