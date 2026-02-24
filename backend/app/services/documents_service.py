"""
Documents Service

Business logic for document management including folders,
document CRUD, and file handling.

This is a thin wrapper around DocumentService that provides the
interface used by the documents API endpoint (using direct returns
and HTTPException-style error handling rather than tuple returns).
"""

import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import FOLDER_EVENTS, FOLDER_FACILITIES
from app.models.document import (
    Document,
    DocumentFolder,
    DocumentStatus,
    FolderVisibility,
)
from app.models.user import User

logger = logging.getLogger(__name__)

# Permissions that grant leadership-level access to all folders
LEADERSHIP_PERMISSIONS = {"documents.manage", "members.manage", "*"}


def _get_user_permissions(user: User) -> Set[str]:
    """Collect all permissions from a user's roles."""
    perms: Set[str] = set()
    for role in user.roles:
        perms.update(role.permissions or [])
    return perms


def _get_user_role_slugs(user: User) -> Set[str]:
    """Collect role slugs from a user's roles."""
    return {role.slug for role in user.roles}


def _is_leadership(user_permissions: Set[str]) -> bool:
    """Check if the user has any leadership-level permission."""
    return bool(user_permissions & LEADERSHIP_PERMISSIONS)


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
            organization_id=organization_id, created_by=created_by, **folder_data
        )
        self.db.add(folder)
        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def get_folders(
        self,
        organization_id: UUID,
        parent_id: Optional[UUID] = None,
        current_user: Optional[User] = None,
    ) -> List[DocumentFolder]:
        """
        Get folders the user is allowed to see.

        Access rules:
        - visibility='organization' → visible to all org members
        - visibility='leadership'   → only users with leadership permissions
        - visibility='owner'        → only the owner_user_id + leadership
        - allowed_roles (if set)    → only users with a matching role slug

        Users with documents.manage, members.manage, or wildcard '*'
        bypass all restrictions (leadership override).
        """
        query = select(DocumentFolder).where(
            DocumentFolder.organization_id == str(organization_id)
        )

        if parent_id:
            query = query.where(DocumentFolder.parent_id == parent_id)
        else:
            query = query.where(DocumentFolder.parent_id.is_(None))

        query = query.order_by(DocumentFolder.sort_order, DocumentFolder.name)
        result = await self.db.execute(query)
        folders = result.scalars().all()

        # Apply access filtering if a user is provided
        if current_user is not None:
            user_perms = _get_user_permissions(current_user)
            leadership = _is_leadership(user_perms)

            if not leadership:
                user_id = str(current_user.id)
                user_roles = _get_user_role_slugs(current_user)
                visible: List[DocumentFolder] = []

                for f in folders:
                    vis = f.visibility or FolderVisibility.ORGANIZATION

                    # Organization-wide folders are always visible
                    if vis == FolderVisibility.ORGANIZATION:
                        # But check allowed_roles if set
                        if f.allowed_roles and not (user_roles & set(f.allowed_roles)):
                            continue
                        visible.append(f)
                    elif vis == FolderVisibility.OWNER:
                        if f.owner_user_id and str(f.owner_user_id) == user_id:
                            visible.append(f)
                    # visibility='leadership' is hidden from non-leadership
                    # (intentionally omitted from visible list)

                folders = visible

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
            .where(DocumentFolder.id == str(folder_id))
            .where(DocumentFolder.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    def can_access_folder(self, folder: DocumentFolder, user: User) -> bool:
        """Check if a user can access a specific folder."""
        user_perms = _get_user_permissions(user)
        if _is_leadership(user_perms):
            return True

        vis = folder.visibility or FolderVisibility.ORGANIZATION

        if vis == FolderVisibility.LEADERSHIP:
            return False

        if vis == FolderVisibility.OWNER:
            return folder.owner_user_id is not None and str(
                folder.owner_user_id
            ) == str(user.id)

        # organization visibility - check allowed_roles if set
        if folder.allowed_roles:
            user_roles = _get_user_role_slugs(user)
            return bool(user_roles & set(folder.allowed_roles))

        return True

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

    async def delete_folder(self, folder_id: UUID, organization_id: UUID) -> bool:
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
            organization_id=organization_id, uploaded_by=uploaded_by, **doc_data
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
        query = select(Document).where(Document.organization_id == str(organization_id))

        if folder_id:
            query = query.where(Document.folder_id == str(folder_id))

        if status:
            query = query.where(Document.status == status)
        else:
            query = query.where(Document.status == DocumentStatus.ACTIVE)

        if search:
            safe_search = (
                search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            )
            search_term = f"%{safe_search}%"
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
            .where(Document.id == str(document_id))
            .where(Document.organization_id == str(organization_id))
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

    async def delete_document(self, document_id: UUID, organization_id: UUID) -> bool:
        """Delete a document. Returns False if not found."""
        document = await self.get_document_by_id(document_id, organization_id)
        if not document:
            return False

        await self.db.delete(document)
        await self.db.commit()
        return True

    # ============================================
    # Per-Member Folder Management
    # ============================================

    async def ensure_member_folder(
        self, organization_id: UUID, user: User
    ) -> DocumentFolder:
        """
        Get or create a personal folder for a member under the
        'Member Files' system folder.  The folder is access-controlled
        so only the member and leadership can see it.

        Folder hierarchy:
          Member Files/              (system, visibility=leadership)
            └── Last, First/         (owner=user, visibility=owner)
        """
        # Find the 'members' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == "members")
            .where(DocumentFolder.is_system.is_(True))
        )
        members_root = result.scalar_one_or_none()

        if not members_root:
            # Auto-create if missing (e.g. org created before this feature)
            from app.models.document import SYSTEM_FOLDERS

            members_def = next(s for s in SYSTEM_FOLDERS if s["slug"] == "members")
            members_root = DocumentFolder(
                organization_id=organization_id,
                name=members_def["name"],
                slug=members_def["slug"],
                description=members_def["description"],
                icon=members_def["icon"],
                color=members_def["color"],
                sort_order=members_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.LEADERSHIP,
            )
            self.db.add(members_root)
            await self.db.flush()
            await self.db.refresh(members_root)

        # Check if user already has a personal folder
        user_id_str = str(user.id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == members_root.id)
            .where(DocumentFolder.owner_user_id == user_id_str)
        )
        member_folder = result.scalar_one_or_none()

        if not member_folder:
            folder_name = f"{user.last_name}, {user.first_name}"
            member_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=members_root.id,
                name=folder_name,
                icon="user",
                color="text-emerald-400",
                visibility=FolderVisibility.OWNER,
                owner_user_id=user_id_str,
                is_system=False,
            )
            self.db.add(member_folder)
            await self.db.flush()
            await self.db.refresh(member_folder)
            logger.info(f"Created member folder '{folder_name}' for user {user_id_str}")

        return member_folder

    # ============================================
    # Per-Apparatus Folder Management
    # ============================================

    async def ensure_apparatus_folder(
        self, organization_id: UUID, apparatus_id: str, apparatus_unit_number: str
    ) -> DocumentFolder:
        """
        Get or create a hierarchical folder structure for an apparatus
        under the 'Apparatus Files' system folder.

        Folder hierarchy:
          Apparatus Files/                      (system, visibility=leadership)
            └── Engine 1 (unit_number)/         (visibility=organization, allowed_roles restricted)
                ├── Photos/
                ├── Registration & Insurance/
                ├── Maintenance Records/
                ├── Inspection & Compliance/
                └── Manuals & References/
        """
        # Find the 'apparatus' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == "apparatus")
            .where(DocumentFolder.is_system.is_(True))
        )
        apparatus_root = result.scalar_one_or_none()

        if not apparatus_root:
            # Auto-create if missing (e.g. org created before this feature)
            from app.models.document import SYSTEM_FOLDERS

            apparatus_def = next(s for s in SYSTEM_FOLDERS if s["slug"] == "apparatus")
            apparatus_root = DocumentFolder(
                organization_id=organization_id,
                name=apparatus_def["name"],
                slug=apparatus_def["slug"],
                description=apparatus_def["description"],
                icon=apparatus_def["icon"],
                color=apparatus_def["color"],
                sort_order=apparatus_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.LEADERSHIP,
            )
            self.db.add(apparatus_root)
            await self.db.flush()
            await self.db.refresh(apparatus_root)

        # Check if this apparatus already has a folder
        apparatus_id_str = str(apparatus_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == apparatus_root.id)
            .where(DocumentFolder.slug == f"apparatus-{apparatus_id_str}")
        )
        vehicle_folder = result.scalar_one_or_none()

        if not vehicle_folder:
            vehicle_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=apparatus_root.id,
                name=apparatus_unit_number,
                slug=f"apparatus-{apparatus_id_str}",
                icon="truck",
                color="text-orange-400",
                visibility=FolderVisibility.ORGANIZATION,
                is_system=False,
            )
            self.db.add(vehicle_folder)
            await self.db.flush()
            await self.db.refresh(vehicle_folder)
            logger.info(
                f"Created apparatus folder '{apparatus_unit_number}' for apparatus {apparatus_id_str}"
            )

            # Create standard sub-folders
            from app.models.document import APPARATUS_SUB_FOLDERS

            for sub_def in APPARATUS_SUB_FOLDERS:
                sub_folder = DocumentFolder(
                    organization_id=organization_id,
                    parent_id=vehicle_folder.id,
                    name=sub_def["name"],
                    slug=f"apparatus-{apparatus_id_str}-{sub_def['slug']}",
                    description=sub_def["description"],
                    icon=sub_def["icon"],
                    color=sub_def["color"],
                    sort_order=sub_def["sort_order"],
                    visibility=FolderVisibility.ORGANIZATION,
                    is_system=False,
                )
                self.db.add(sub_folder)

            await self.db.flush()
            logger.info(
                f"Created {len(APPARATUS_SUB_FOLDERS)} sub-folders for apparatus '{apparatus_unit_number}'"
            )

        return vehicle_folder

    async def get_apparatus_sub_folders(
        self, organization_id: UUID, apparatus_id: str
    ) -> List[DocumentFolder]:
        """
        Get the sub-folders for a specific apparatus.
        Returns an empty list if the apparatus folder doesn't exist.
        """
        # Find the apparatus root
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == "apparatus")
            .where(DocumentFolder.is_system.is_(True))
        )
        apparatus_root = result.scalar_one_or_none()
        if not apparatus_root:
            return []

        # Find the vehicle folder
        apparatus_id_str = str(apparatus_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == apparatus_root.id)
            .where(DocumentFolder.slug == f"apparatus-{apparatus_id_str}")
        )
        vehicle_folder = result.scalar_one_or_none()
        if not vehicle_folder:
            return []

        # Get sub-folders with document counts
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == vehicle_folder.id)
            .order_by(DocumentFolder.sort_order, DocumentFolder.name)
        )
        sub_folders = list(result.scalars().all())

        for folder in sub_folders:
            count_result = await self.db.execute(
                select(func.count(Document.id))
                .where(Document.folder_id == folder.id)
                .where(Document.status == DocumentStatus.ACTIVE)
            )
            folder.document_count = count_result.scalar() or 0

        return sub_folders

    # ============================================
    # Per-Facility Folder Management
    # ============================================

    async def ensure_facility_folder(
        self, organization_id: UUID, facility_id: str, facility_display_name: str
    ) -> DocumentFolder:
        """
        Get or create a hierarchical folder structure for a facility
        under the 'Facility Files' system folder.

        Folder hierarchy:
          Facility Files/                           (system, visibility=leadership)
            └── Station 1 - Main St (display_name)/ (visibility=organization)
                ├── Photos/
                ├── Blueprints & Permits/
                ├── Maintenance Records/
                ├── Inspection Reports/
                ├── Insurance & Leases/
                └── Capital Projects/
        """
        # Find the 'facilities' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_FACILITIES)
            .where(DocumentFolder.is_system.is_(True))
        )
        facilities_root = result.scalar_one_or_none()

        if not facilities_root:
            from app.models.document import SYSTEM_FOLDERS

            facilities_def = next(
                s for s in SYSTEM_FOLDERS if s["slug"] == FOLDER_FACILITIES
            )
            facilities_root = DocumentFolder(
                organization_id=organization_id,
                name=facilities_def["name"],
                slug=facilities_def["slug"],
                description=facilities_def["description"],
                icon=facilities_def["icon"],
                color=facilities_def["color"],
                sort_order=facilities_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.LEADERSHIP,
            )
            self.db.add(facilities_root)
            await self.db.flush()
            await self.db.refresh(facilities_root)

        # Check if this facility already has a folder
        facility_id_str = str(facility_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == facilities_root.id)
            .where(DocumentFolder.slug == f"facility-{facility_id_str}")
        )
        facility_folder = result.scalar_one_or_none()

        if not facility_folder:
            facility_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=facilities_root.id,
                name=facility_display_name,
                slug=f"facility-{facility_id_str}",
                icon="building",
                color="text-indigo-400",
                visibility=FolderVisibility.ORGANIZATION,
                is_system=False,
            )
            self.db.add(facility_folder)
            await self.db.flush()
            await self.db.refresh(facility_folder)
            logger.info(
                f"Created facility folder '{facility_display_name}' for facility {facility_id_str}"
            )

            # Create standard sub-folders
            from app.models.document import FACILITY_SUB_FOLDERS

            for sub_def in FACILITY_SUB_FOLDERS:
                sub_folder = DocumentFolder(
                    organization_id=organization_id,
                    parent_id=facility_folder.id,
                    name=sub_def["name"],
                    slug=f"facility-{facility_id_str}-{sub_def['slug']}",
                    description=sub_def["description"],
                    icon=sub_def["icon"],
                    color=sub_def["color"],
                    sort_order=sub_def["sort_order"],
                    visibility=FolderVisibility.ORGANIZATION,
                    is_system=False,
                )
                self.db.add(sub_folder)

            await self.db.flush()
            logger.info(
                f"Created {len(FACILITY_SUB_FOLDERS)} sub-folders for facility '{facility_display_name}'"
            )

        return facility_folder

    async def get_facility_sub_folders(
        self, organization_id: UUID, facility_id: str
    ) -> List[DocumentFolder]:
        """
        Get the sub-folders for a specific facility.
        Returns an empty list if the facility folder doesn't exist.
        """
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_FACILITIES)
            .where(DocumentFolder.is_system.is_(True))
        )
        facilities_root = result.scalar_one_or_none()
        if not facilities_root:
            return []

        facility_id_str = str(facility_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == facilities_root.id)
            .where(DocumentFolder.slug == f"facility-{facility_id_str}")
        )
        facility_folder = result.scalar_one_or_none()
        if not facility_folder:
            return []

        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == facility_folder.id)
            .order_by(DocumentFolder.sort_order, DocumentFolder.name)
        )
        sub_folders = list(result.scalars().all())

        for folder in sub_folders:
            count_result = await self.db.execute(
                select(func.count(Document.id))
                .where(Document.folder_id == folder.id)
                .where(Document.status == DocumentStatus.ACTIVE)
            )
            folder.document_count = count_result.scalar() or 0

        return sub_folders

    # ============================================
    # Per-Event Folder Management
    # ============================================

    async def ensure_event_folder(
        self, organization_id: UUID, event_id: str, event_title: str
    ) -> DocumentFolder:
        """
        Get or create a folder for an event under the 'Event Attachments'
        system folder. Events get a single folder (no sub-folders) since
        their attachments are simpler.

        Folder hierarchy:
          Event Attachments/                  (system, visibility=organization)
            └── Monthly Meeting - Feb 2026/   (per-event folder)
        """
        # Find the 'events' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_EVENTS)
            .where(DocumentFolder.is_system.is_(True))
        )
        events_root = result.scalar_one_or_none()

        if not events_root:
            from app.models.document import SYSTEM_FOLDERS

            events_def = next(s for s in SYSTEM_FOLDERS if s["slug"] == FOLDER_EVENTS)
            events_root = DocumentFolder(
                organization_id=organization_id,
                name=events_def["name"],
                slug=events_def["slug"],
                description=events_def["description"],
                icon=events_def["icon"],
                color=events_def["color"],
                sort_order=events_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.ORGANIZATION,
            )
            self.db.add(events_root)
            await self.db.flush()
            await self.db.refresh(events_root)

        # Check if this event already has a folder
        event_id_str = str(event_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == events_root.id)
            .where(DocumentFolder.slug == f"event-{event_id_str}")
        )
        event_folder = result.scalar_one_or_none()

        if not event_folder:
            event_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=events_root.id,
                name=event_title,
                slug=f"event-{event_id_str}",
                icon="calendar",
                color="text-rose-400",
                visibility=FolderVisibility.ORGANIZATION,
                is_system=False,
            )
            self.db.add(event_folder)
            await self.db.flush()
            await self.db.refresh(event_folder)
            logger.info(
                f"Created event folder '{event_title}' for event {event_id_str}"
            )

        return event_folder

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get documents summary statistics"""
        # Total documents
        total_result = await self.db.execute(
            select(func.count(Document.id))
            .where(Document.organization_id == str(organization_id))
            .where(Document.status == DocumentStatus.ACTIVE)
        )
        total_documents = total_result.scalar() or 0

        # Total folders
        folder_result = await self.db.execute(
            select(func.count(DocumentFolder.id)).where(
                DocumentFolder.organization_id == str(organization_id)
            )
        )
        total_folders = folder_result.scalar() or 0

        # Total size
        size_result = await self.db.execute(
            select(func.coalesce(func.sum(Document.file_size), 0))
            .where(Document.organization_id == str(organization_id))
            .where(Document.status == DocumentStatus.ACTIVE)
        )
        total_size = size_result.scalar() or 0

        # Documents this month
        first_of_month = date.today().replace(day=1)
        month_result = await self.db.execute(
            select(func.count(Document.id))
            .where(Document.organization_id == str(organization_id))
            .where(
                Document.created_at
                >= datetime.combine(first_of_month, datetime.min.time())
            )
        )
        documents_this_month = month_result.scalar() or 0

        return {
            "total_documents": total_documents,
            "total_folders": total_folders,
            "total_size_bytes": total_size,
            "documents_this_month": documents_this_month,
        }
