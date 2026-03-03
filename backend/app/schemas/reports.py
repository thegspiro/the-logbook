"""
Reports Pydantic Schemas

Request and response schemas for report generation endpoints.
"""

from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

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


class MemberRosterEntry(BaseModel):
    """Single member entry in roster report"""

    id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    membership_number: Optional[str] = None
    rank: Optional[str] = None
    status: Optional[str] = None
    station: Optional[str] = None
    joined_date: Optional[str] = None
    roles: List[str] = []


class MemberRosterReport(BaseModel):
    """Member roster report"""

    report_type: str = "member_roster"
    generated_at: str
    total_members: int
    active_members: int
    inactive_members: int
    members: List[MemberRosterEntry]


# ============================================
# Training Summary Report
# ============================================


class TrainingSummaryEntry(BaseModel):
    """Training summary per member"""

    member_id: str
    member_name: str
    total_courses: int = 0
    completed_courses: int = 0
    total_hours: float = 0
    compliance_percentage: float = 0


class TrainingSummaryReport(BaseModel):
    """Training summary report"""

    report_type: str = "training_summary"
    generated_at: str
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    total_courses: int = 0
    total_records: int = 0
    completion_rate: float = 0
    entries: List[TrainingSummaryEntry]


# ============================================
# Event Attendance Report
# ============================================


class EventAttendanceEntry(BaseModel):
    """Event attendance entry"""

    event_id: str
    event_title: str
    event_date: Optional[str] = None
    total_rsvps: int = 0
    attended: int = 0
    attendance_rate: float = 0


class EventAttendanceReport(BaseModel):
    """Event attendance report"""

    report_type: str = "event_attendance"
    generated_at: str
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    total_events: int = 0
    average_attendance_rate: float = 0
    events: List[EventAttendanceEntry]


# ============================================
# Reports Summary
# ============================================


class ReportsSummary(BaseModel):
    """Available reports summary"""

    available_reports: List[Dict[str, Any]]


# ============================================
# Saved / Scheduled Reports
# ============================================


class SavedReportCreate(BaseModel):
    """Schema for creating a saved report configuration"""

    name: str
    description: Optional[str] = None
    report_type: str
    filters: Optional[Dict[str, Any]] = None
    is_scheduled: bool = False
    schedule_frequency: Optional[str] = None  # daily, weekly, monthly, quarterly
    schedule_day: Optional[int] = None
    email_recipients: Optional[List[str]] = None


class SavedReportUpdate(BaseModel):
    """Schema for updating a saved report"""

    name: Optional[str] = None
    description: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None
    is_scheduled: Optional[bool] = None
    schedule_frequency: Optional[str] = None
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
    created_by: str
    created_at: str
    updated_at: str
