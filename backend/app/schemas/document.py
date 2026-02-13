"""
Document Pydantic Schemas

Request and response schemas for document management endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime


class FolderCreate(BaseModel):
    """Schema for creating a document folder"""
    name: str = Field(..., min_length=1, max_length=200)
    slug: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    parent_folder_id: Optional[str] = None
    sort_order: int = Field(default=0, ge=0)
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=50)


class FolderUpdate(BaseModel):
    """Schema for updating a folder"""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    sort_order: Optional[int] = Field(None, ge=0)
    icon: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=50)


class FolderResponse(BaseModel):
    """Folder response schema"""
    id: str
    organization_id: str
    name: str
    slug: str
    description: Optional[str] = None
    parent_folder_id: Optional[str] = None
    sort_order: int
    is_system: bool
    icon: Optional[str] = None
    color: Optional[str] = None
    document_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentCreate(BaseModel):
    """Schema for creating a document"""
    folder_id: str
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    file_path: Optional[str] = None
    file_name: Optional[str] = Field(None, max_length=255)
    file_size: Optional[int] = None
    mime_type: Optional[str] = Field(None, max_length=100)
    content_html: Optional[str] = None
    tags: Optional[List[str]] = None


class DocumentUpdate(BaseModel):
    """Schema for updating a document"""
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    folder_id: Optional[str] = None
    tags: Optional[List[str]] = None


class DocumentResponse(BaseModel):
    """Document response schema"""
    id: str
    organization_id: str
    folder_id: str
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


class DocumentListItem(BaseModel):
    """Compact document listing"""
    id: str
    folder_id: str
    title: str
    description: Optional[str] = None
    document_type: str
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    source_type: Optional[str] = None
    tags: Optional[List[str]] = None
    created_by: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
