"""
Notification Pydantic Schemas

Request and response schemas for notification management endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Any
from datetime import datetime
from uuid import UUID


# ============================================
# Notification Rule Schemas
# ============================================

class NotificationRuleCreate(BaseModel):
    """Schema for creating a notification rule"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    trigger: str
    category: str = "general"
    channel: str = "in_app"
    enabled: bool = True
    config: Optional[Any] = None


class NotificationRuleUpdate(BaseModel):
    """Schema for updating a notification rule"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    trigger: Optional[str] = None
    category: Optional[str] = None
    channel: Optional[str] = None
    enabled: Optional[bool] = None
    config: Optional[Any] = None


class NotificationRuleResponse(BaseModel):
    """Schema for notification rule response"""
    id: UUID
    organization_id: UUID
    name: str
    description: Optional[str] = None
    trigger: str
    category: str
    channel: str
    enabled: bool
    config: Optional[Any] = None
    created_at: datetime
    updated_at: datetime
    created_by: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)


class NotificationRulesListResponse(BaseModel):
    """Schema for notification rules list"""
    rules: List[NotificationRuleResponse]
    total: int


# ============================================
# Notification Log Schemas
# ============================================

class NotificationLogResponse(BaseModel):
    """Schema for notification log response"""
    id: UUID
    organization_id: UUID
    rule_id: Optional[UUID] = None
    rule_name: Optional[str] = None
    recipient_id: Optional[UUID] = None
    recipient_email: Optional[str] = None
    recipient_name: Optional[str] = None
    channel: str
    category: Optional[str] = None
    subject: Optional[str] = None
    message: Optional[str] = None
    sent_at: datetime
    delivered: bool
    read: bool
    read_at: Optional[datetime] = None
    error: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationLogsListResponse(BaseModel):
    """Schema for paginated notification logs list"""
    logs: List[NotificationLogResponse]
    total: int
    skip: int
    limit: int


# ============================================
# Summary Schemas
# ============================================

class NotificationsSummary(BaseModel):
    """Schema for notifications module summary"""
    total_rules: int
    active_rules: int
    emails_sent_this_month: int
    notifications_sent_this_month: int
