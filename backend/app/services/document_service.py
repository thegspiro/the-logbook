"""
Document Service

Business logic for document management, folder organization,
and publishing meeting minutes as formatted documents.
"""

import logging
from typing import List, Optional
from uuid import UUID
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from html import escape
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.models.document import Document, DocumentFolder, DocumentType, SYSTEM_FOLDERS
from app.models.minute import MeetingMinutes, MinutesStatus
from app.models.user import Organization
from app.schemas.document import FolderCreate, FolderUpdate, DocumentCreate, DocumentUpdate

logger = logging.getLogger(__name__)


class DocumentService:
    """Service for document and folder management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Folder Management
    # ============================================

    async def initialize_system_folders(self, organization_id: UUID, created_by: UUID) -> List[DocumentFolder]:
        """Create system folders for an organization if none exist"""
        existing = await self.db.execute(
            select(func.count(DocumentFolder.id))
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.is_system == True)
        )
        if (existing.scalar() or 0) > 0:
            return await self.list_folders(organization_id)

        folders = []
        for folder_def in SYSTEM_FOLDERS:
            folder = DocumentFolder(
                organization_id=str(organization_id),
                created_by=str(created_by),
                is_system=True,
                **folder_def,
            )
            self.db.add(folder)
            folders.append(folder)

        await self.db.commit()
        for f in folders:
            await self.db.refresh(f)
        return folders

    async def list_folders(
        self, organization_id: UUID, parent_id: Optional[str] = None
    ) -> List[DocumentFolder]:
        """List folders for an organization"""
        query = (
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
        )
        if parent_id:
            query = query.where(DocumentFolder.parent_id == parent_id)
        else:
            query = query.where(DocumentFolder.parent_id.is_(None))

        query = query.order_by(DocumentFolder.sort_order, DocumentFolder.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_folder(
        self, folder_id: str, organization_id: UUID
    ) -> Optional[DocumentFolder]:
        """Get a folder by ID"""
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.id == folder_id)
            .where(DocumentFolder.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def get_folder_by_slug(
        self, slug: str, organization_id: UUID
    ) -> Optional[DocumentFolder]:
        """Get a folder by slug"""
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.slug == slug)
            .where(DocumentFolder.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def create_folder(
        self, data: FolderCreate, organization_id: UUID, created_by: UUID
    ) -> DocumentFolder:
        """Create a custom folder"""
        folder = DocumentFolder(
            organization_id=str(organization_id),
            created_by=str(created_by),
            is_system=False,
            name=data.name,
            slug=data.slug,
            description=data.description,
            parent_id=data.parent_folder_id,
            sort_order=data.sort_order,
            icon=data.icon,
            color=data.color,
        )
        self.db.add(folder)
        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def update_folder(
        self, folder_id: str, organization_id: UUID, data: FolderUpdate
    ) -> Optional[DocumentFolder]:
        """Update a folder (system folders: only description, icon, color)"""
        folder = await self.get_folder(folder_id, organization_id)
        if not folder:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # System folders cannot have their name or sort_order changed
        if folder.is_system:
            update_data.pop("name", None)
            update_data.pop("sort_order", None)

        for field, value in update_data.items():
            setattr(folder, field, value)

        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def delete_folder(
        self, folder_id: str, organization_id: UUID
    ) -> bool:
        """Delete a folder (system folders cannot be deleted)"""
        folder = await self.get_folder(folder_id, organization_id)
        if not folder or folder.is_system:
            return False

        await self.db.delete(folder)
        await self.db.commit()
        return True

    async def get_folder_document_count(
        self, folder_id: str, organization_id: UUID
    ) -> int:
        """Get the number of documents in a folder"""
        result = await self.db.execute(
            select(func.count(Document.id))
            .where(Document.folder_id == folder_id)
            .where(Document.organization_id == str(organization_id))
        )
        return result.scalar() or 0

    # ============================================
    # Document CRUD
    # ============================================

    async def list_documents(
        self,
        organization_id: UUID,
        folder_id: Optional[str] = None,
        document_type: Optional[str] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> List[Document]:
        """List documents with filtering"""
        query = (
            select(Document)
            .where(Document.organization_id == str(organization_id))
        )
        if folder_id:
            query = query.where(Document.folder_id == folder_id)
        if document_type:
            query = query.where(Document.document_type == document_type)
        if search:
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.where(Document.name.ilike(f"%{safe_search}%"))

        query = query.order_by(Document.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_document(
        self, document_id: str, organization_id: UUID
    ) -> Optional[Document]:
        """Get a document by ID"""
        result = await self.db.execute(
            select(Document)
            .where(Document.id == document_id)
            .where(Document.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def create_document(
        self, data: DocumentCreate, organization_id: UUID, uploaded_by: UUID,
        document_type: str = "uploaded", source_type: Optional[str] = None,
        source_id: Optional[str] = None, content_html: Optional[str] = None,
    ) -> Document:
        """Create a document record"""
        doc = Document(
            folder_id=data.folder_id,
            name=data.title,
            description=data.description,
            file_name=data.file_name or "",
            file_path=data.file_path or "",
            file_size=data.file_size or 0,
            file_type=data.mime_type,
            organization_id=str(organization_id),
            uploaded_by=str(uploaded_by),
            document_type=DocumentType(document_type),
            source_type=source_type,
            source_id=source_id,
        )
        if content_html:
            doc.content_html = content_html
        if data.tags:
            doc.tags = ",".join(data.tags)
        self.db.add(doc)
        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    async def update_document(
        self, document_id: str, organization_id: UUID, data: DocumentUpdate
    ) -> Optional[Document]:
        """Update a document"""
        doc = await self.get_document(document_id, organization_id)
        if not doc:
            return None

        update_data = data.model_dump(exclude_unset=True)
        # Map schema field 'title' to model field 'name'
        if "title" in update_data:
            update_data["name"] = update_data.pop("title")
        # Convert tags list to comma-separated string
        if "tags" in update_data and isinstance(update_data["tags"], list):
            update_data["tags"] = ",".join(update_data["tags"])
        for field, value in update_data.items():
            setattr(doc, field, value)

        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    async def delete_document(
        self, document_id: str, organization_id: UUID
    ) -> bool:
        """Delete a document"""
        doc = await self.get_document(document_id, organization_id)
        if not doc:
            return False
        await self.db.delete(doc)
        await self.db.commit()
        return True

    # ============================================
    # Publish Meeting Minutes
    # ============================================

    async def publish_minutes(
        self, minutes: MeetingMinutes, organization_id: UUID, published_by: UUID
    ) -> Document:
        """
        Publish approved meeting minutes as a formatted HTML document
        in the 'Meeting Minutes' system folder.
        """
        if minutes.status != MinutesStatus.APPROVED.value:
            raise ValueError("Only approved minutes can be published")

        # Get or create the meeting-minutes folder
        folder = await self.get_folder_by_slug("meeting-minutes", organization_id)
        if not folder:
            folders = await self.initialize_system_folders(organization_id, published_by)
            folder = next((f for f in folders if f.slug == "meeting-minutes"), None)
            if not folder:
                raise RuntimeError("Failed to create meeting-minutes folder")

        # Look up organization timezone for local date formatting
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org = org_result.scalar_one_or_none()
        tz_name = org.timezone if org else None

        # Generate HTML
        html = self._generate_minutes_html(minutes, tz_name)

        # Check if already published (update instead of creating duplicate)
        if minutes.published_document_id:
            existing = await self.get_document(minutes.published_document_id, organization_id)
            if existing:
                existing.content_html = html
                existing.name = minutes.title
                existing.updated_at = datetime.utcnow()
                await self.db.commit()
                await self.db.refresh(existing)
                return existing

        # Create the document
        meeting_date = minutes.meeting_date.strftime("%Y-%m-%d") if minutes.meeting_date else "unknown"
        mt_value = minutes.meeting_type if isinstance(minutes.meeting_type, str) else minutes.meeting_type.value
        doc = Document(
            organization_id=str(organization_id),
            folder_id=folder.id,
            name=minutes.title,
            description=f"Meeting minutes from {meeting_date}",
            document_type=DocumentType.GENERATED,
            content_html=html,
            file_type="text/html",
            source_type="meeting_minutes",
            source_id=minutes.id,
            tags=",".join(["meeting-minutes", mt_value]),
            uploaded_by=str(published_by),
        )
        self.db.add(doc)
        await self.db.flush()

        # Update the minutes record with the published document reference
        minutes.published_document_id = doc.id
        await self.db.commit()
        await self.db.refresh(doc)
        return doc

    def _to_local(self, dt: datetime, tz_name: Optional[str]) -> datetime:
        """Convert a UTC datetime to the organization's local timezone."""
        if not tz_name or not dt:
            return dt
        return dt.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name))

    def _generate_minutes_html(self, minutes: MeetingMinutes, tz_name: Optional[str] = None) -> str:
        """Generate formatted HTML for published meeting minutes"""
        header = minutes.get_effective_header() or {}
        footer = minutes.get_effective_footer() or {}

        mt_display = minutes.meeting_type if isinstance(minutes.meeting_type, str) else minutes.meeting_type.value
        meeting_date = self._to_local(minutes.meeting_date, tz_name).strftime("%B %d, %Y at %I:%M %p") if minutes.meeting_date else ""

        parts = []

        # Document header
        parts.append('<div class="minutes-document">')
        parts.append('<div class="minutes-header" style="text-align:center; border-bottom:2px solid #1e3a5f; padding-bottom:16px; margin-bottom:24px;">')
        if header.get("org_name"):
            parts.append(f'<h1 style="margin:0; font-size:24px; color:#1e3a5f;">{escape(header["org_name"])}</h1>')
        subtitle = header.get("subtitle", "Official Meeting Minutes")
        parts.append(f'<h2 style="margin:4px 0 0; font-size:16px; color:#666; font-weight:normal;">{escape(subtitle)}</h2>')
        parts.append('</div>')

        # Meeting info
        parts.append('<div class="minutes-info" style="margin-bottom:24px;">')
        parts.append(f'<h3 style="margin:0 0 8px; font-size:20px; color:#1e3a5f;">{escape(minutes.title)}</h3>')
        info_items = []
        if header.get("show_meeting_type", True):
            info_items.append(f'<strong>Type:</strong> {escape(mt_display.replace("_", " ").title())}')
        if header.get("show_date", True):
            info_items.append(f'<strong>Date:</strong> {escape(meeting_date)}')
        if minutes.location:
            info_items.append(f'<strong>Location:</strong> {escape(minutes.location)}')
        if minutes.called_by:
            info_items.append(f'<strong>Called by:</strong> {escape(minutes.called_by)}')
        if info_items:
            parts.append('<p style="color:#444; font-size:14px; margin:4px 0;">' + ' &nbsp;|&nbsp; '.join(info_items) + '</p>')

        # Called to order / adjourned
        if minutes.called_to_order_at:
            parts.append(f'<p style="font-size:13px; color:#666;">Called to order: {self._to_local(minutes.called_to_order_at, tz_name).strftime("%I:%M %p")}</p>')
        if minutes.adjourned_at:
            parts.append(f'<p style="font-size:13px; color:#666;">Adjourned: {self._to_local(minutes.adjourned_at, tz_name).strftime("%I:%M %p")}</p>')
        parts.append('</div>')

        # Attendees
        if minutes.attendees:
            parts.append('<div class="minutes-attendees" style="margin-bottom:24px;">')
            parts.append('<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">Attendance</h4>')
            present = [a for a in minutes.attendees if a.get("present", True)]
            absent = [a for a in minutes.attendees if not a.get("present", True)]
            if present:
                names = ", ".join(
                    f'{escape(a["name"])}' + (f' ({escape(a["role"])})' if a.get("role") else "")
                    for a in present
                )
                parts.append(f'<p style="font-size:13px;"><strong>Present ({len(present)}):</strong> {names}</p>')
            if absent:
                names = ", ".join(escape(a["name"]) for a in absent)
                parts.append(f'<p style="font-size:13px; color:#999;"><strong>Absent ({len(absent)}):</strong> {names}</p>')
            if minutes.quorum_met is not None:
                q_text = "Quorum met" if minutes.quorum_met else "Quorum NOT met"
                if minutes.quorum_count:
                    q_text += f" ({minutes.quorum_count} members)"
                parts.append(f'<p style="font-size:13px;"><strong>{q_text}</strong></p>')
            parts.append('</div>')

        # Content sections
        sections = minutes.get_sections()
        if sections:
            for section in sorted(sections, key=lambda s: s.get("order", 0)):
                content = section.get("content", "")
                if content and content.strip():
                    title = escape(section.get("title", section.get("key", "Section")))
                    parts.append(f'<div class="minutes-section" style="margin-bottom:20px;">')
                    parts.append(f'<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">{title}</h4>')
                    parts.append(f'<div style="font-size:14px; color:#333; white-space:pre-wrap;">{escape(content)}</div>')
                    parts.append('</div>')

        # Motions
        if minutes.motions:
            parts.append('<div class="minutes-motions" style="margin-bottom:24px;">')
            parts.append(f'<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">Motions ({len(minutes.motions)})</h4>')
            for i, motion in enumerate(minutes.motions, 1):
                status = motion.status if isinstance(motion.status, str) else motion.status.value
                color = "#16a34a" if status == "passed" else "#dc2626" if status == "failed" else "#ca8a04"
                parts.append(f'<div style="border:1px solid #ddd; border-radius:4px; padding:12px; margin-bottom:8px;">')
                parts.append(f'<p style="margin:0 0 4px; font-size:14px;"><strong>Motion #{i}</strong> — <span style="color:{color}; font-weight:bold;">{escape(status.upper())}</span></p>')
                parts.append(f'<p style="margin:0 0 8px; font-size:14px;">{escape(motion.motion_text)}</p>')
                detail_parts = []
                if motion.moved_by:
                    detail_parts.append(f'Moved by: {escape(motion.moved_by)}')
                if motion.seconded_by:
                    detail_parts.append(f'Seconded by: {escape(motion.seconded_by)}')
                if motion.votes_for is not None:
                    detail_parts.append(f'Vote: {motion.votes_for}-{motion.votes_against or 0}' + (f' ({motion.votes_abstain} abstain)' if motion.votes_abstain else ''))
                if detail_parts:
                    parts.append(f'<p style="margin:0; font-size:12px; color:#666;">{" | ".join(detail_parts)}</p>')
                parts.append('</div>')
            parts.append('</div>')

        # Action Items
        if minutes.action_items:
            parts.append('<div class="minutes-action-items" style="margin-bottom:24px;">')
            parts.append(f'<h4 style="color:#1e3a5f; border-bottom:1px solid #ddd; padding-bottom:4px;">Action Items ({len(minutes.action_items)})</h4>')
            parts.append('<table style="width:100%; border-collapse:collapse; font-size:13px;">')
            parts.append('<tr style="background:#f3f4f6;"><th style="padding:6px; text-align:left; border:1px solid #ddd;">Description</th><th style="padding:6px; text-align:left; border:1px solid #ddd;">Assignee</th><th style="padding:6px; text-align:left; border:1px solid #ddd;">Due</th><th style="padding:6px; text-align:left; border:1px solid #ddd;">Priority</th></tr>')
            for item in minutes.action_items:
                due = self._to_local(item.due_date, tz_name).strftime("%Y-%m-%d") if item.due_date else "—"
                priority = item.priority if isinstance(item.priority, str) else item.priority.value
                parts.append(f'<tr><td style="padding:6px; border:1px solid #ddd;">{escape(item.description)}</td><td style="padding:6px; border:1px solid #ddd;">{escape(item.assignee_name or "—")}</td><td style="padding:6px; border:1px solid #ddd;">{escape(due)}</td><td style="padding:6px; border:1px solid #ddd;">{escape(priority)}</td></tr>')
            parts.append('</table>')
            parts.append('</div>')

        # Footer
        parts.append('<div class="minutes-footer" style="border-top:1px solid #ddd; padding-top:12px; margin-top:32px; font-size:11px; color:#999;">')
        footer_parts = []
        if footer.get("left_text"):
            footer_parts.append(escape(footer["left_text"]))
        if footer.get("center_text"):
            footer_parts.append(escape(footer["center_text"]))
        if footer.get("confidentiality_notice"):
            footer_parts.append(escape(footer["confidentiality_notice"]))
        if footer_parts:
            parts.append('<p style="text-align:center;">' + ' &nbsp;|&nbsp; '.join(footer_parts) + '</p>')

        if minutes.approved_at:
            parts.append(f'<p style="text-align:center;">Approved: {self._to_local(minutes.approved_at, tz_name).strftime("%B %d, %Y")}</p>')
        parts.append('</div>')

        parts.append('</div>')
        return '\n'.join(parts)
