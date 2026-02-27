"""
Platform Analytics Schemas

Pydantic response models for the platform-wide analytics endpoint.
"""

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class DailyCount(BaseModel):
    """A single day's count for trend data."""

    date: str  # YYYY-MM-DD
    count: int


class ModuleUsage(BaseModel):
    """Usage summary for a single platform module."""

    name: str
    enabled: bool
    record_count: int
    last_activity: Optional[str] = None  # ISO datetime or None


class PlatformAnalyticsResponse(BaseModel):
    """Aggregated platform-wide analytics for IT admins."""

    # User Adoption
    total_users: int = 0
    active_users: int = 0
    inactive_users: int = 0
    new_users_last_30_days: int = 0
    adoption_rate: float = 0.0
    login_trend: List[DailyCount] = []

    # Module Usage
    modules: List[ModuleUsage] = []

    # Operational Activity
    total_events: int = 0
    events_last_30_days: int = 0
    total_check_ins: int = 0
    training_hours_last_30_days: float = 0.0
    forms_submitted_last_30_days: int = 0

    # System Health
    errors_last_7_days: int = 0
    error_trend: List[DailyCount] = []
    top_error_types: Dict[str, int] = {}

    # Content
    total_documents: int = 0
    documents_last_30_days: int = 0

    generated_at: datetime
