"""
Reports Pydantic Schemas

Request and response schemas for report generation endpoints.
"""

from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# ============================================
# Report Request Schemas
# ============================================


class ReportRequest(BaseModel):
    """Schema for requesting a report"""

    report_type: (
        str  # member_roster, training_summary, event_attendance, compliance_status
    )
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    filters: Optional[Dict[str, Any]] = None


# ============================================
# Member Roster Report
# ============================================


# ============================================
# Training Summary Report
# ============================================


# ============================================
# Event Attendance Report
# ============================================


# ============================================
# Reports Summary
# ============================================


# ============================================
# Saved / Scheduled Reports
# ============================================


class SavedReportCreate(BaseModel):
    """Schema for creating a saved report configuration"""

    # Bounds match saved_reports' column widths (models/analytics.py) so an
    # overlong value 422s here instead of reaching db.commit() and raising an
    # uncaught DataError under MySQL strict mode (RPT-29).
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    report_type: str = Field(min_length=1, max_length=50)
    filters: Optional[Dict[str, Any]] = None
    is_scheduled: bool = False
    schedule_frequency: Optional[str] = Field(
        None, max_length=20
    )  # daily, weekly, monthly, quarterly
    schedule_day: Optional[int] = None
    email_recipients: Optional[List[str]] = None


class SavedReportUpdate(BaseModel):
    """Schema for updating a saved report"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    is_scheduled: Optional[bool] = None
    schedule_frequency: Optional[str] = Field(None, max_length=20)
    schedule_day: Optional[int] = None
    email_recipients: Optional[List[str]] = None


class SavedReportResponse(BaseModel):
    """Response schema for a saved report"""

    id: str
    name: str
    description: Optional[str] = None
    report_type: str
    filters: Optional[Dict[str, Any]] = None
    is_scheduled: bool = False
    schedule_frequency: Optional[str] = None
    schedule_day: Optional[int] = None
    email_recipients: Optional[List[str]] = None
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    # No scheduler reads is_scheduled/schedule_frequency/next_run_date yet —
    # always False until one exists (see app/models/analytics.py). Lets the
    # UI label a saved report as "not yet automated" instead of "Active".
    enforced: bool = False
    created_by: str
    created_at: str
    updated_at: str
