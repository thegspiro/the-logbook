"""
Documents Pydantic Schemas

Request and response schemas for document management endpoints.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import UTCResponseBase

# ============================================
# Document Folder Schemas
# ============================================


class DocumentFolderCreate(BaseModel):
    """Schema for creating a document folder"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    color: str = Field(default="#3B82F6", max_length=20)
    icon: str = Field(default="folder", max_length=50)
    parent_id: Optional[UUID] = None
    visibility: str = Field(
        default="organization", pattern="^(organization|leadership|owner)$"
    )
    owner_user_id: Optional[UUID] = None
    allowed_roles: Optional[List[str]] = None


class DocumentFolderUpdate(BaseModel):
    """Schema for updating a document folder"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)
    parent_id: Optional[UUID] = None
    visibility: Optional[str] = Field(None, pattern="^(organization|leadership|owner)$")
    owner_user_id: Optional[UUID] = None
    allowed_roles: Optional[List[str]] = None


class DocumentFolderResponse(UTCResponseBase):
    """Schema for folder response"""

    id: UUID
    organization_id: UUID
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    color: str
    icon: str
    is_system: bool = False
    sort_order: int = 0
    parent_id: Optional[UUID] = None
    visibility: str = "organization"
    owner_user_id: Optional[UUID] = None
    allowed_roles: Optional[List[str]] = None
    document_count: Optional[int] = 0
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Document Schemas
# ============================================


class DocumentCreate(BaseModel):
    """Schema for creating a document (metadata only, file uploaded separately)"""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    folder_id: Optional[UUID] = None
    tags: Optional[str] = None


class DocumentUpdate(BaseModel):
    """Schema for updating a document"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    folder_id: Optional[UUID] = None
    tags: Optional[str] = None
    status: Optional[str] = None


class DocumentResponse(UTCResponseBase):
    """Schema for document response"""

    id: UUID
    organization_id: UUID
    folder_id: Optional[UUID] = None
    name: str
    description: Optional[str] = None
    file_name: Optional[str] = None
    file_size: int = 0
    file_type: Optional[str] = None
    status: str = "active"
    version: int = 1
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    uploaded_by: Optional[UUID] = None
    uploader_name: Optional[str] = None
    folder_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DocumentsListResponse(BaseModel):
    """Schema for paginated documents list"""

    documents: List[DocumentResponse]
    total: int
    skip: int
    limit: int


class FoldersListResponse(BaseModel):
    """Schema for folders list"""

    folders: List[DocumentFolderResponse]
    total: int


# ============================================
# Summary Schemas
# ============================================


class DocumentsSummary(BaseModel):
    """Schema for documents module summary"""

    total_documents: int
    total_folders: int
    total_size_bytes: int
    documents_this_month: int


# ============================================
# Internal DocumentService / minutes-publish schemas
# ============================================
# These model a *different projection* of the documents table than the
# endpoint schemas above: the minutes-publish response renames columns
# (name -> title, file_type -> mime_type, uploaded_by -> created_by) and
# exposes source/content fields. Kept distinct on purpose — do not merge
# their fields with the endpoint DocumentResponse/DocumentCreate above.


class ServiceFolderCreate(BaseModel):
    """Folder-create schema used by the internal DocumentService."""

    name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    parent_folder_id: Optional[str] = None
    sort_order: int = Field(default=0, ge=0)
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=50)


class ServiceFolderUpdate(BaseModel):
    """Folder-update schema used by the internal DocumentService."""

    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = Field(None, ge=0)
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=50)


class ServiceDocumentCreate(BaseModel):
    """Document-create schema used by the internal DocumentService."""

    folder_id: str
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    file_path: Optional[str] = None
    file_name: Optional[str] = Field(None, max_length=255)
    file_size: Optional[int] = None
    mime_type: Optional[str] = Field(None, max_length=100)
    content_html: Optional[str] = None
    tags: Optional[List[str]] = None


class ServiceDocumentUpdate(BaseModel):
    """Document-update schema used by the internal DocumentService."""

    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    folder_id: Optional[str] = None
    tags: Optional[List[str]] = None


class PublishedDocumentResponse(UTCResponseBase):
    """Document response for the minutes-publish endpoint.

    A minutes-specific projection: renames model columns (name -> title,
    file_type -> mime_type, uploaded_by -> created_by) and returns tags as a
    list. Distinct from the endpoint ``DocumentResponse`` above.
    """

    id: str
    organization_id: str
    folder_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    document_type: str
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    content_html: Optional[str] = None
    source_type: Optional[str] = None
    source_id: Optional[str] = None
    tags: Optional[List[str]] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
