"""
Notification Pydantic Schemas

Request and response schemas for notification management endpoints.
"""

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.notification import (
    NotificationCategory,
    NotificationChannel,
    NotificationTrigger,
)
from app.schemas.base import UTCResponseBase

# trigger / category / channel map to strict MySQL ENUM columns, but were typed as
# free str and stored raw (create_rule's **rule_data, update_rule's setattr loop) —
# an out-of-set value passed Pydantic, reached MySQL, and 500'd (NOTIF2-4, the B1
# latent-500 class). Validate at the request schema so a bad value is a clean 422.
_TRIGGERS = {e.value for e in NotificationTrigger}
_CATEGORIES = {e.value for e in NotificationCategory}
_CHANNELS = {e.value for e in NotificationChannel}


def _rule_enum_validator(valid: set, field: str):
    def _check(value):
        if value is None:
            return value
        normalized = value.lower() if isinstance(value, str) else value
        if normalized not in valid:
            raise ValueError(
                f"Invalid {field} '{value}'. Must be one of: "
                f"{', '.join(sorted(valid))}"
            )
        return normalized

    return _check


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

    _check_trigger = field_validator("trigger")(
        _rule_enum_validator(_TRIGGERS, "trigger")
    )
    _check_category = field_validator("category")(
        _rule_enum_validator(_CATEGORIES, "category")
    )
    _check_channel = field_validator("channel")(
        _rule_enum_validator(_CHANNELS, "channel")
    )


class NotificationRuleUpdate(BaseModel):
    """Schema for updating a notification rule"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    trigger: Optional[str] = None
    category: Optional[str] = None
    channel: Optional[str] = None
    enabled: Optional[bool] = None
    config: Optional[Any] = None

    _check_trigger = field_validator("trigger")(
        _rule_enum_validator(_TRIGGERS, "trigger")
    )
    _check_category = field_validator("category")(
        _rule_enum_validator(_CATEGORIES, "category")
    )
    _check_channel = field_validator("channel")(
        _rule_enum_validator(_CHANNELS, "channel")
    )


class NotificationRuleResponse(UTCResponseBase):
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


class NotificationLogResponse(UTCResponseBase):
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
    pinned: bool = False
    error: Optional[str] = None
    action_url: Optional[str] = None
    notification_metadata: Optional[Any] = Field(
        default=None, serialization_alias="metadata"
    )
    expires_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


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


# ============================================
# Web Push
# ============================================


class PushSubscriptionKeys(BaseModel):
    """The `keys` object exactly as the browser's PushSubscription exposes it."""

    p256dh: str = Field(..., max_length=255)
    auth: str = Field(..., max_length=255)


class PushSubscriptionCreate(BaseModel):
    """Mirrors PushSubscription.toJSON() so the client can post it unchanged."""

    endpoint: str = Field(..., min_length=1, max_length=2048)
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(..., min_length=1, max_length=2048)


class PushConfigResponse(BaseModel):
    """Tells the client whether to offer push, and the key needed to subscribe.

    `public_key` is null when push is not configured, so the UI can hide the
    toggle rather than offering something that will fail on tap.
    """

    enabled: bool
    public_key: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PushSubscriptionResponse(BaseModel):
    id: str
    endpoint: str

    model_config = ConfigDict(from_attributes=True)
