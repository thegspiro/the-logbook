"""
Documents Service

Business logic for document management including folders,
document CRUD, and file handling.

This is a thin wrapper around DocumentService that provides the
interface used by the documents API endpoint (using direct returns
and HTTPException-style error handling rather than tuple returns).
"""

import logging
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from app.models.document import Document, DocumentFolder, DocumentStatus
from app.models.user import User

logger = logging.getLogger(__name__)


class DocumentsService:
    """Service for document management used by the documents endpoint"""

    UPLOAD_DIR = "/app/uploads/documents"

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Folder Management
    # ============================================

    async def create_folder(
        self, organization_id: UUID, folder_data: Dict[str, Any], created_by: UUID
    ) -> DocumentFolder:
        """Create a new document folder. Raises on failure."""
        folder = DocumentFolder(
            organization_id=organization_id,
            created_by=created_by,
            **folder_data
        )
        self.db.add(folder)
        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def get_folders(
        self, organization_id: UUID, parent_id: Optional[UUID] = None
    ) -> List[DocumentFolder]:
        """Get all folders for an organization, optionally filtered by parent"""
        query = (
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == organization_id)
        )

        if parent_id:
            query = query.where(DocumentFolder.parent_id == parent_id)
        else:
            query = query.where(DocumentFolder.parent_id.is_(None))

        query = query.order_by(DocumentFolder.name)
        result = await self.db.execute(query)
        folders = result.scalars().all()

        # Add document counts
        for folder in folders:
            count_result = await self.db.execute(
                select(func.count(Document.id))
                .where(Document.folder_id == folder.id)
                .where(Document.status == DocumentStatus.ACTIVE)
            )
            folder.document_count = count_result.scalar() or 0

        return folders

    async def get_folder_by_id(
        self, folder_id: UUID, organization_id: UUID
    ) -> Optional[DocumentFolder]:
        """Get a folder by ID"""
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.id == folder_id)
            .where(DocumentFolder.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def update_folder(
        self, folder_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[DocumentFolder]:
        """Update a folder. Returns None if not found."""
        folder = await self.get_folder_by_id(folder_id, organization_id)
        if not folder:
            return None

        for key, value in update_data.items():
            setattr(folder, key, value)

        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def delete_folder(
        self, folder_id: UUID, organization_id: UUID
    ) -> bool:
        """Delete a folder and all its documents. Returns False if not found."""
        folder = await self.get_folder_by_id(folder_id, organization_id)
        if not folder:
            return False

        await self.db.delete(folder)
        await self.db.commit()
        return True

    # ============================================
    # Document Management
    # ============================================

    async def create_document(
        self,
        organization_id: UUID,
        doc_data: Dict[str, Any],
        uploaded_by: UUID,
    ) -> Document:
        """Create a new document record. Raises on failure."""
        document = Document(
            organization_id=organization_id,
            uploaded_by=uploaded_by,
            **doc_data
        )
        self.db.add(document)
        await self.db.commit()
        await self.db.refresh(document)
        return document

    async def get_documents(
        self,
        organization_id: UUID,
        folder_id: Optional[UUID] = None,
        search: Optional[str] = None,
        status: Optional[DocumentStatus] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[Document], int]:
        """Get documents with filtering and pagination"""
        query = (
            select(Document)
            .where(Document.organization_id == organization_id)
        )

        if folder_id:
            query = query.where(Document.folder_id == folder_id)

        if status:
            query = query.where(Document.status == status)
        else:
            query = query.where(Document.status == DocumentStatus.ACTIVE)

        if search:
            search_term = f"%{search}%"
            query = query.where(
                Document.name.ilike(search_term)
                | Document.description.ilike(search_term)
                | Document.tags.ilike(search_term)
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(Document.updated_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        documents = result.scalars().all()

        return documents, total

    async def get_document_by_id(
        self, document_id: UUID, organization_id: UUID
    ) -> Optional[Document]:
        """Get a document by ID"""
        result = await self.db.execute(
            select(Document)
            .where(Document.id == document_id)
            .where(Document.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def update_document(
        self, document_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[Document]:
        """Update a document. Returns None if not found."""
        document = await self.get_document_by_id(document_id, organization_id)
        if not document:
            return None

        for key, value in update_data.items():
            setattr(document, key, value)

        await self.db.commit()
        await self.db.refresh(document)
        return document

    async def delete_document(
        self, document_id: UUID, organization_id: UUID
    ) -> bool:
        """Delete a document. Returns False if not found."""
        document = await self.get_document_by_id(document_id, organization_id)
        if not document:
            return False

        await self.db.delete(document)
        await self.db.commit()
        return True

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get documents summary statistics"""
        # Total documents
        total_result = await self.db.execute(
            select(func.count(Document.id))
            .where(Document.organization_id == organization_id)
            .where(Document.status == DocumentStatus.ACTIVE)
        )
        total_documents = total_result.scalar() or 0

        # Total folders
        folder_result = await self.db.execute(
            select(func.count(DocumentFolder.id))
            .where(DocumentFolder.organization_id == organization_id)
        )
        total_folders = folder_result.scalar() or 0

        # Total size
        size_result = await self.db.execute(
            select(func.coalesce(func.sum(Document.file_size), 0))
            .where(Document.organization_id == organization_id)
            .where(Document.status == DocumentStatus.ACTIVE)
        )
        total_size = size_result.scalar() or 0

        # Documents this month
        first_of_month = date.today().replace(day=1)
        month_result = await self.db.execute(
            select(func.count(Document.id))
            .where(Document.organization_id == organization_id)
            .where(Document.created_at >= datetime.combine(first_of_month, datetime.min.time()))
        )
        documents_this_month = month_result.scalar() or 0

        return {
            "total_documents": total_documents,
            "total_folders": total_folders,
            "total_size_bytes": total_size,
            "documents_this_month": documents_this_month,
        }
