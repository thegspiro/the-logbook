"""
Documents Pydantic Schemas

Request and response schemas for document management endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from uuid import UUID


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


class DocumentFolderUpdate(BaseModel):
    """Schema for updating a document folder"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)
    icon: Optional[str] = Field(None, max_length=50)
    parent_id: Optional[UUID] = None


class DocumentFolderResponse(BaseModel):
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


class DocumentResponse(BaseModel):
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
