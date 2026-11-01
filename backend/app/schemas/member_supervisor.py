"""
Schemas for a member's supervisor ("reports to") assignments.

snake_case on the wire, as every schema read by the member profile is.
"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class SupervisorAssignmentSet(BaseModel):
    """Set or change who a member reports to."""

    supervisor_id: str = Field(..., min_length=1, max_length=36)
    # Omitted means today on the department's calendar.
    starts_on: Optional[date] = None


class SupervisorAssignmentEnd(BaseModel):
    """End the assignment in effect, leaving the member with no supervisor."""

    # Omitted means today on the department's calendar. Inclusive: the
    # supervisor is still the member's supervisor on this date.
    ends_on: Optional[date] = None


class SupervisorAssignmentResponse(BaseModel):
    id: str
    # None once the supervisor's account has been removed (the FK is SET NULL).
    supervisor_id: Optional[str] = None
    supervisor_name: Optional[str] = None
    starts_on: date
    ends_on: Optional[date] = None
    created_at: Optional[datetime] = None


class MemberSupervisorResponse(BaseModel):
    member_id: str
    # The open assignment with a supervisor on record, if any.
    current: Optional[SupervisorAssignmentResponse] = None
    # Every assignment, newest first, the current one included.
    history: List[SupervisorAssignmentResponse]


class SupervisorCandidateResponse(BaseModel):
    id: str
    name: str
    membership_number: Optional[str] = None


class SupervisorCandidateListResponse(BaseModel):
    candidates: List[SupervisorCandidateResponse]
