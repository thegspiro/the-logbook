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
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
import uuid

from app.core.database import Base


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())


class DocumentStatus(str, enum.Enum):
    """Status of a document"""
    ACTIVE = "active"
    ARCHIVED = "archived"


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
    description = Column(Text)
    color = Column(String(20), default="#3B82F6")
    icon = Column(String(50), default="folder")

    # Hierarchy
    parent_id = Column(String(36), ForeignKey("document_folders.id", ondelete="CASCADE"))

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_by = Column(String(36), ForeignKey("users.id"))

    # Relationships
    documents = relationship("Document", back_populates="folder", cascade="all, delete-orphan")
    children = relationship("DocumentFolder", backref="parent", remote_side=[id], cascade="all, delete-orphan", single_parent=True)

    __table_args__ = (
        Index("idx_doc_folders_org", "organization_id"),
        Index("idx_doc_folders_parent", "parent_id"),
    )

    def __repr__(self):
        return f"<DocumentFolder(name={self.name})>"


class Document(Base):
    """
    Document model

    Represents a file uploaded to the document management system.
    """

    __tablename__ = "documents"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id = Column(String(36), ForeignKey("document_folders.id", ondelete="SET NULL"), index=True)

    # Document Information
    name = Column(String(255), nullable=False)
    description = Column(Text)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(BigInteger, default=0)  # Size in bytes
    file_type = Column(String(100))  # MIME type
    status = Column(Enum(DocumentStatus, values_callable=lambda x: [e.value for e in x]), default=DocumentStatus.ACTIVE, nullable=False)

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
