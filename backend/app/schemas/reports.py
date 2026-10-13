"""
Reports Pydantic Schemas

Request and response schemas for report generation endpoints.
"""

from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field

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
    # Addresses only; whether each may receive the report is the PII gate's
    # decision at save and at send (app/services/saved_report_schedule.py).
    email_recipients: Optional[List[EmailStr]] = None


class SavedReportUpdate(BaseModel):
    """Schema for updating a saved report"""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    is_scheduled: Optional[bool] = None
    schedule_frequency: Optional[str] = Field(None, max_length=20)
    schedule_day: Optional[int] = None
    email_recipients: Optional[List[EmailStr]] = None


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
    # True when the schedule is live: the saved_report_delivery task reads
    # is_scheduled/schedule_frequency/next_run_date (RPT2-29-2). Kept so a
    # client written against the earlier always-False field still reads it.
    enforced: bool = False
    created_by: str
    created_at: str
    updated_at: str
