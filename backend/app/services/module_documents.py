"""Files a module keeps as real documents, in that module's folder.

Apparatus photos and documents, and finance receipts, are uploaded through
their own module's endpoints and stored as ``Document`` rows in the module's
folder tree (docs/FILE_STORAGE_HARDENING.md decisions 12 and 13). The module
row keeps a ``document_id`` link; the bytes live once, in document storage,
behind the folder's rights.

The module endpoint authorizes the caller against the module record; this
module also holds the download to the document's own folder rights, so a
document moved into a folder the caller cannot open is not served through the
module's door either.
"""

import asyncio
import os
from datetime import date
from typing import Iterable, Optional

from fastapi import HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentFolder
from app.models.user import User
from app.services import file_storage_service as file_storage
from app.services.documents_service import DocumentsService
from app.services.file_storage_service import (
    FileRules,
    FileStorageService,
    StorageArea,
)
from app.utils import download_names

# Types a browser may render inline from this origin. Everything else is sent
# as an attachment.
_INLINE_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})

IMAGE_FILE_RULES = FileRules(
    allowed_types={
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    },
    max_bytes=20 * 1024 * 1024,
    description="JPEG, PNG, GIF or WebP images",
)


async def store_as_document(
    db: AsyncSession,
    upload: UploadFile,
    *,
    user: User,
    folder: DocumentFolder,
    name: str,
    rules: FileRules,
    upload_kind: str,
    source_type: str,
    source_id: str,
    description: Optional[str] = None,
) -> Document:
    """Scan and store *upload*, and add a ``Document`` for it in *folder*.

    Flushes, does not commit: the caller adds its own link row in the same
    transaction. If that transaction fails the caller removes the file with
    :func:`discard_file`.
    """
    organization_id = str(user.organization_id)
    stored = await FileStorageService(db).store_upload(
        upload,
        organization_id=organization_id,
        area=StorageArea.DOCUMENTS,
        rules=rules,
        user=user,
        upload_kind=upload_kind,
    )
    document = Document(
        organization_id=organization_id,
        folder_id=str(folder.id),
        name=name,
        description=description,
        file_name=stored.original_name,
        file_path=stored.path,
        file_size=stored.size,
        file_type=stored.mime_type,
        source_type=source_type,
        source_id=str(source_id),
        uploaded_by=str(user.id),
    )
    db.add(document)
    try:
        await db.flush()
    except Exception:
        await asyncio.to_thread(file_storage.remove_quietly, stored.path)
        raise
    return document


async def discard_file(document: Optional[Document]) -> None:
    """Remove a just-stored file whose transaction did not commit."""
    if document is not None and document.file_path:
        await asyncio.to_thread(file_storage.remove_quietly, document.file_path)


async def document_in_org(
    db: AsyncSession, document_id: Optional[str], organization_id: str
) -> Optional[Document]:
    if not document_id:
        return None
    return (
        await db.execute(
            select(Document).where(
                Document.id == str(document_id),
                Document.organization_id == str(organization_id),
            )
        )
    ).scalar_one_or_none()


async def serve_document(
    db: AsyncSession,
    document_id: Optional[str],
    user: User,
    *,
    name_parts: Iterable[object],
    fallback: str,
    day: Optional[date] = None,
    inline_images: bool = False,
) -> FileResponse:
    """Serve a module document's bytes, or 404.

    404 rather than 403 for a document the caller's folder rights do not
    admit, so a guessed id does not reveal that the file exists.
    """
    organization_id = str(user.organization_id)
    document = await document_in_org(db, document_id, organization_id)
    service = DocumentsService(db)
    if (
        document is None
        or not document.file_path
        or not await service.can_access_document(document, organization_id, user)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    path = file_storage.resolve(
        document.file_path, organization_id, StorageArea.DOCUMENTS
    )
    if path is None:
        logger.warning(
            f"Refused to serve document {document.id}: its stored path is outside "
            "the organization's storage"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )
    if not await asyncio.to_thread(os.path.isfile, path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    extension = download_names.stored_extension(path)
    media_type = document.file_type or "application/octet-stream"
    inline = inline_images and media_type in _INLINE_IMAGE_TYPES
    return FileResponse(
        path=path,
        filename=download_names.descriptive_filename(
            day, *name_parts, extension=extension, fallback=fallback
        ),
        media_type=media_type,
        content_disposition_type="inline" if inline else "attachment",
    )


async def delete_document(db: AsyncSession, document_id: str, user: User) -> None:
    """Delete a module document and its file.

    The module's link rows reference the document with ON DELETE CASCADE, so
    they go with it.
    """
    await DocumentsService(db).delete_document(
        document_id, str(user.organization_id), user
    )
