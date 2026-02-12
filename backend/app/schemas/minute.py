"""
Meeting Minutes Pydantic Schemas

Request and response schemas for meeting minutes endpoints.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID


# ============================================
# Motion Schemas
# ============================================

class MotionBase(BaseModel):
    """Base motion schema"""
    motion_text: str = Field(..., min_length=1, max_length=2000, description="Text of the motion")
    moved_by: Optional[str] = Field(None, max_length=200, description="Name of person who moved")
    seconded_by: Optional[str] = Field(None, max_length=200, description="Name of person who seconded")
    discussion_notes: Optional[str] = None
    status: str = Field(default="passed", description="Motion result: passed, failed, tabled, withdrawn")
    votes_for: Optional[int] = Field(None, ge=0)
    votes_against: Optional[int] = Field(None, ge=0)
    votes_abstain: Optional[int] = Field(None, ge=0)


class MotionCreate(MotionBase):
    """Schema for creating a motion"""
    order: int = Field(default=0, ge=0, description="Display order within the minutes")


class MotionUpdate(BaseModel):
    """Schema for updating a motion"""
    motion_text: Optional[str] = Field(None, min_length=1, max_length=2000)
    moved_by: Optional[str] = Field(None, max_length=200)
    seconded_by: Optional[str] = Field(None, max_length=200)
    discussion_notes: Optional[str] = None
    status: Optional[str] = None
    votes_for: Optional[int] = Field(None, ge=0)
    votes_against: Optional[int] = Field(None, ge=0)
    votes_abstain: Optional[int] = Field(None, ge=0)
    order: Optional[int] = Field(None, ge=0)


class MotionResponse(MotionBase):
    """Motion response schema"""
    id: str
    minutes_id: str
    order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Action Item Schemas
# ============================================

class ActionItemBase(BaseModel):
    """Base action item schema"""
    description: str = Field(..., min_length=1, max_length=2000, description="Description of the action item")
    assignee_id: Optional[str] = Field(None, description="UUID of the assigned user")
    assignee_name: Optional[str] = Field(None, max_length=200, description="Name of the assignee (for display)")
    due_date: Optional[datetime] = None
    priority: str = Field(default="medium", description="Priority: low, medium, high, urgent")


class ActionItemCreate(ActionItemBase):
    """Schema for creating an action item"""
    pass


class ActionItemUpdate(BaseModel):
    """Schema for updating an action item"""
    description: Optional[str] = Field(None, min_length=1, max_length=2000)
    assignee_id: Optional[str] = None
    assignee_name: Optional[str] = Field(None, max_length=200)
    due_date: Optional[datetime] = None
    priority: Optional[str] = None
    status: Optional[str] = Field(None, description="Status: pending, in_progress, completed, cancelled, overdue")
    completion_notes: Optional[str] = None


class ActionItemResponse(ActionItemBase):
    """Action item response schema"""
    id: str
    minutes_id: str
    status: str
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================
# Meeting Minutes Schemas
# ============================================

class AttendeeEntry(BaseModel):
    """Individual attendee record"""
    user_id: Optional[str] = None
    name: str = Field(..., min_length=1, max_length=200)
    role: Optional[str] = Field(None, max_length=100)
    present: bool = True


class MinutesBase(BaseModel):
    """Base meeting minutes schema"""
    title: str = Field(..., min_length=1, max_length=300, description="Title of the meeting minutes")
    meeting_type: str = Field(default="business", description="Meeting type: business, special, committee, board, other")
    meeting_date: datetime = Field(..., description="Date and time of the meeting")
    location: Optional[str] = Field(None, max_length=300)
    called_by: Optional[str] = Field(None, max_length=200, description="Person who called the meeting")
    called_to_order_at: Optional[datetime] = None
    adjourned_at: Optional[datetime] = None
    attendees: Optional[List[AttendeeEntry]] = None
    quorum_met: Optional[bool] = None
    quorum_count: Optional[int] = Field(None, ge=0)
    agenda: Optional[str] = None
    old_business: Optional[str] = None
    new_business: Optional[str] = None
    treasurer_report: Optional[str] = None
    chief_report: Optional[str] = None
    committee_reports: Optional[str] = None
    announcements: Optional[str] = None
    notes: Optional[str] = None
    event_id: Optional[str] = Field(None, description="Optional link to an event")


class MinutesCreate(MinutesBase):
    """Schema for creating meeting minutes"""
    motions: Optional[List[MotionCreate]] = Field(None, description="Motions to create with the minutes")
    action_items: Optional[List[ActionItemCreate]] = Field(None, description="Action items to create with the minutes")


class MinutesUpdate(BaseModel):
    """Schema for updating meeting minutes"""
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    meeting_type: Optional[str] = None
    meeting_date: Optional[datetime] = None
    location: Optional[str] = Field(None, max_length=300)
    called_by: Optional[str] = Field(None, max_length=200)
    called_to_order_at: Optional[datetime] = None
    adjourned_at: Optional[datetime] = None
    attendees: Optional[List[AttendeeEntry]] = None
    quorum_met: Optional[bool] = None
    quorum_count: Optional[int] = Field(None, ge=0)
    agenda: Optional[str] = None
    old_business: Optional[str] = None
    new_business: Optional[str] = None
    treasurer_report: Optional[str] = None
    chief_report: Optional[str] = None
    committee_reports: Optional[str] = None
    announcements: Optional[str] = None
    notes: Optional[str] = None
    event_id: Optional[str] = None


class MinutesResponse(MinutesBase):
    """Meeting minutes response schema"""
    id: str
    organization_id: str
    status: str
    submitted_at: Optional[datetime] = None
    submitted_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    rejected_at: Optional[datetime] = None
    rejected_by: Optional[str] = None
    rejection_reason: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    motions: List[MotionResponse] = []
    action_items: List[ActionItemResponse] = []

    model_config = ConfigDict(from_attributes=True)


class MinutesListItem(BaseModel):
    """Compact response for listing minutes"""
    id: str
    title: str
    meeting_type: str
    meeting_date: datetime
    status: str
    location: Optional[str] = None
    called_by: Optional[str] = None
    motions_count: int = 0
    action_items_count: int = 0
    open_action_items: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MinutesSubmit(BaseModel):
    """Schema for submitting minutes for approval"""
    pass


class MinutesApprove(BaseModel):
    """Schema for approving minutes"""
    pass


class MinutesReject(BaseModel):
    """Schema for rejecting minutes"""
    reason: str = Field(..., min_length=10, max_length=500, description="Reason for rejection")


class MinutesSearchResult(BaseModel):
    """Full-text search result"""
    id: str
    title: str
    meeting_type: str
    meeting_date: datetime
    status: str
    snippet: str = Field(..., description="Matching text snippet")
    match_field: str = Field(..., description="Which field matched")

    model_config = ConfigDict(from_attributes=True)
