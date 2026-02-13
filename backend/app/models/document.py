"""
Document Models

Database models for the organization document management system.
Supports folder-based organization, file uploads, and generated documents
(such as published meeting minutes).
"""

from sqlalchemy import (
    Column,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Enum as SQLEnum,
    Index,
    JSON,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from enum import Enum
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


class DocumentType(str, Enum):
    """How the document was created"""
    UPLOADED = "uploaded"
    GENERATED = "generated"  # e.g., published meeting minutes


class DocumentFolder(Base):
    """
    Document Folder

    Organizes documents into a hierarchical folder structure.
    System folders (is_system=True) are auto-created and cannot be deleted.
    """
    __tablename__ = "document_folders"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(200), nullable=False)
    slug = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    parent_folder_id = Column(String(36), ForeignKey("document_folders.id", ondelete="CASCADE"), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    is_system = Column(Boolean, nullable=False, default=False)
    icon = Column(String(50), nullable=True)
    color = Column(String(50), nullable=True)

    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    documents = relationship("Document", back_populates="folder", cascade="all, delete-orphan")
    children = relationship("DocumentFolder", backref="parent", remote_side=[id], cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_document_folders_organization_id", "organization_id"),
        Index("ix_document_folders_slug", "organization_id", "slug"),
        Index("ix_document_folders_parent", "parent_folder_id"),
    )


# Default system folders created for every organization
SYSTEM_FOLDERS = [
    {"slug": "meeting-minutes", "name": "Meeting Minutes", "description": "Published meeting minutes", "sort_order": 0, "icon": "clipboard-list", "color": "text-cyan-400"},
    {"slug": "sops", "name": "SOPs & Procedures", "description": "Standard Operating Procedures", "sort_order": 1, "icon": "file-text", "color": "text-amber-400"},
    {"slug": "policies", "name": "Policies", "description": "Department policies and guidelines", "sort_order": 2, "icon": "shield", "color": "text-blue-400"},
    {"slug": "forms", "name": "Forms & Templates", "description": "Blank forms and document templates", "sort_order": 3, "icon": "file", "color": "text-green-400"},
    {"slug": "reports", "name": "Reports", "description": "Monthly, quarterly, and annual reports", "sort_order": 4, "icon": "bar-chart", "color": "text-purple-400"},
    {"slug": "training", "name": "Training Materials", "description": "Training manuals and reference materials", "sort_order": 5, "icon": "book-open", "color": "text-red-400"},
    {"slug": "general", "name": "General Documents", "description": "Miscellaneous department files", "sort_order": 6, "icon": "folder", "color": "text-slate-400"},
]


class Document(Base):
    """
    Document model

    Represents either an uploaded file or a system-generated document
    (like published meeting minutes). Belongs to a folder.
    """
    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    folder_id = Column(String(36), ForeignKey("document_folders.id", ondelete="CASCADE"), nullable=False)

    title = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    document_type = Column(SQLEnum(DocumentType, values_callable=lambda x: [e.value for e in x]), nullable=False, default=DocumentType.UPLOADED)

    # For uploaded files
    file_path = Column(Text, nullable=True)
    file_name = Column(String(255), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)

    # For generated documents (e.g., published minutes HTML)
    content_html = Column(Text, nullable=True)

    # Source reference (e.g., minutes_id for published minutes)
    source_type = Column(String(50), nullable=True)  # "meeting_minutes"
    source_id = Column(String(36), nullable=True)

    # Tags for search/filtering
    tags = Column(JSON, nullable=True)

    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    folder = relationship("DocumentFolder", back_populates="documents")

    __table_args__ = (
        Index("ix_documents_organization_id", "organization_id"),
        Index("ix_documents_folder_id", "folder_id"),
        Index("ix_documents_source", "source_type", "source_id"),
        Index("ix_documents_document_type", "document_type"),
    )
