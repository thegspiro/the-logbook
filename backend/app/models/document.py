"""
Documents Database Models

SQLAlchemy models for document management including folders,
documents, and version tracking.
"""

from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    Integer,
    Text,
    Enum,
    ForeignKey,
    Index,
    BigInteger,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.core.utils import generate_uuid

from app.core.database import Base


class DocumentStatus(str, enum.Enum):
    """Status of a document"""
    ACTIVE = "active"
    ARCHIVED = "archived"


class DocumentType(str, enum.Enum):
    """How the document was created"""
    UPLOADED = "uploaded"
    GENERATED = "generated"


class FolderVisibility(str, enum.Enum):
    """Who can see a folder and its contents"""
    ORGANIZATION = "organization"  # All org members with documents.view
    LEADERSHIP = "leadership"      # Only users with members.manage or documents.manage
    OWNER = "owner"                # Only the owner_user_id (+ leadership)


# System folders created automatically for each organization
SYSTEM_FOLDERS = [
    {"slug": "meeting-minutes", "name": "Meeting Minutes", "description": "Published meeting minutes", "sort_order": 0, "icon": "clipboard-list", "color": "text-cyan-400"},
    {"slug": "sops", "name": "SOPs & Procedures", "description": "Standard Operating Procedures", "sort_order": 1, "icon": "file-text", "color": "text-amber-400"},
    {"slug": "policies", "name": "Policies", "description": "Department policies and guidelines", "sort_order": 2, "icon": "shield", "color": "text-blue-400"},
    {"slug": "forms", "name": "Forms & Templates", "description": "Blank forms and document templates", "sort_order": 3, "icon": "file", "color": "text-green-400"},
    {"slug": "reports", "name": "Reports", "description": "Monthly, quarterly, and annual reports", "sort_order": 4, "icon": "bar-chart", "color": "text-purple-400"},
    {"slug": "training", "name": "Training Materials", "description": "Training manuals and reference materials", "sort_order": 5, "icon": "book-open", "color": "text-red-400"},
    {"slug": "general", "name": "General Documents", "description": "Miscellaneous department files", "sort_order": 6, "icon": "folder", "color": "text-slate-400"},
    {"slug": "members", "name": "Member Files", "description": "Per-member folders (auto-created, access-controlled)", "sort_order": 7, "icon": "users", "color": "text-emerald-400"},
]


class DocumentFolder(Base):
    """
    Document Folder model

    Represents a folder for organizing documents.
    Supports nested folders via parent_id.
    """

    __tablename__ = "document_folders"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Folder Information
    name = Column(String(255), nullable=False)
    slug = Column(String(100), nullable=True)
    description = Column(Text)
    color = Column(String(20), default="#3B82F6")
    icon = Column(String(50), default="folder")
    is_system = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)

    # Hierarchy
    parent_id = Column(String(36), ForeignKey("document_folders.id", ondelete="CASCADE"))

    # Access control
    visibility = Column(
        Enum(FolderVisibility, values_callable=lambda x: [e.value for e in x]),
        default=FolderVisibility.ORGANIZATION,
        nullable=False,
        server_default="organization",
    )
    owner_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    allowed_roles = Column(JSON, nullable=True)  # List of role slugs; null = no restriction

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    documents = relationship("Document", back_populates="folder", cascade="all, delete-orphan")
    children = relationship("DocumentFolder", backref="parent", remote_side=[id], cascade="all, delete-orphan", single_parent=True)
    owner = relationship("User", foreign_keys=[owner_user_id])

    __table_args__ = (
        Index("idx_doc_folders_org", "organization_id"),
        Index("idx_doc_folders_parent", "parent_id"),
        Index("idx_doc_folders_owner", "owner_user_id"),
    )

    def __repr__(self):
        return f"<DocumentFolder(name={self.name})>"


class Document(Base):
    """
    Document model

    Represents a file uploaded or generated in the document management system.
    """

    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id = Column(String(36), ForeignKey("document_folders.id", ondelete="SET NULL"), index=True)

    # Document Information
    name = Column(String(255), nullable=False)
    description = Column(Text)
    file_name = Column(String(255))
    file_path = Column(String(500))
    file_size = Column(BigInteger, default=0)  # Size in bytes
    file_type = Column(String(100))  # MIME type
    document_type = Column(Enum(DocumentType, values_callable=lambda x: [e.value for e in x]), default=DocumentType.UPLOADED)
    status = Column(Enum(DocumentStatus, values_callable=lambda x: [e.value for e in x]), default=DocumentStatus.ACTIVE, nullable=False)

    # Rich content (for generated documents like published minutes)
    content_html = Column(Text, nullable=True)

    # Source tracking (links generated docs to their origin)
    source_type = Column(String(50), nullable=True)  # e.g. "meeting_minutes"
    source_id = Column(String(36), nullable=True)

    # Versioning
    version = Column(Integer, default=1)

    # Metadata
    tags = Column(Text)  # Comma-separated tags

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    uploaded_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    folder = relationship("DocumentFolder", back_populates="documents")
    uploader = relationship("User", foreign_keys=[uploaded_by])

    __table_args__ = (
        Index("idx_documents_org", "organization_id"),
        Index("idx_documents_folder", "folder_id"),
        Index("idx_documents_org_status", "organization_id", "status"),
    )

    def __repr__(self):
        return f"<Document(name={self.name}, type={self.file_type})>"
