"""
Role Pydantic Schemas

Request and response schemas for role-related endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
from datetime import datetime
from uuid import UUID


class RoleBase(BaseModel):
    """Base role schema"""
    name: str = Field(..., min_length=1, max_length=100)
    slug: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None


class RoleCreate(RoleBase):
    """Schema for creating a new role"""
    permissions: List[str] = Field(default_factory=list)
    priority: int = Field(default=0, ge=0, le=100)


class RoleUpdate(BaseModel):
    """Schema for updating a role"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    permissions: Optional[List[str]] = None
    priority: Optional[int] = Field(None, ge=0, le=100)


class RoleResponse(BaseModel):
    """Schema for role response"""
    id: UUID
    organization_id: UUID
    name: str
    slug: str
    description: Optional[str] = None
    permissions: List[str] = []
    is_system: bool
    priority: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PermissionDetail(BaseModel):
    """Schema for permission details"""
    name: str
    description: str
    category: str


class PermissionCategory(BaseModel):
    """Schema for permission category with permissions"""
    category: str
    permissions: List[PermissionDetail]


class UserRoleAssignment(BaseModel):
    """Schema for assigning roles to a user"""
    role_ids: List[UUID] = Field(..., description="List of role IDs to assign to the user")


class UserRoleResponse(BaseModel):
    """Schema for user with their assigned roles"""
    user_id: UUID
    username: str
    full_name: Optional[str] = None
    roles: List[RoleResponse]

    model_config = ConfigDict(from_attributes=True)
