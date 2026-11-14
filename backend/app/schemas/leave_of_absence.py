"""Department leave-of-absence settings, and members' leave requests.

The settings live in ``Organization.settings["leave_of_absence"]``. Every field
defaults to today's behaviour, so a department that never opens the screen
keeps it: a reminder 7 days before a leave ends, copied to the officers who
manage leave, and member requests off.

Responses are snake_case, as the rest of the member-leave endpoints are.
"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.leave_request import LeaveDecisionRule, LeaveRequestStatus, LeaveVote
from app.models.user import LeaveType

# More than any department has offices, and few enough to keep one routing
# query small.
MAX_APPROVER_POSITIONS = 20


class LeaveOfAbsenceSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # Days before a leave's end date the member is reminded; 0 sends none.
    end_reminder_days: int = Field(default=7, ge=0, le=60)
    # Also email the officers who manage leave (members.manage).
    end_reminder_copy_officers: bool = True
    # Members may ask for leave from their profile.
    requests_enabled: bool = False
    # Who decides a request. Empty, or nobody holding them, falls back to the
    # Chief, then to everyone who can record leave.
    request_approver_position_ids: List[str] = Field(
        default_factory=list, max_length=MAX_APPROVER_POSITIONS
    )
    request_decision_rule: LeaveDecisionRule = LeaveDecisionRule.ANY

    @field_validator("request_approver_position_ids")
    @classmethod
    def _dedupe(cls, ids: List[str]) -> List[str]:
        return list(dict.fromkeys(str(i) for i in ids if i))


def settings_from(raw: object) -> LeaveOfAbsenceSettings:
    """Read the stored section defensively (CLAUDE.md pitfall #19).

    The section is unvalidated JSON once stored; a value someone wrote by hand
    degrades to the defaults rather than raising inside a scheduled task.
    """
    if not isinstance(raw, dict):
        return LeaveOfAbsenceSettings()
    try:
        return LeaveOfAbsenceSettings.model_validate(raw)
    except ValueError:
        return LeaveOfAbsenceSettings()


class LeaveApproverPosition(BaseModel):
    id: str
    name: str
    holder_count: int


class LeaveSettingsResponse(LeaveOfAbsenceSettings):
    # The positions a department may choose from, with how many current
    # members hold each, so the screen can warn about a vacant office.
    available_positions: List[LeaveApproverPosition] = Field(default_factory=list)


class LeaveRequestCreate(BaseModel):
    leave_type: LeaveType = LeaveType.LEAVE_OF_ABSENCE
    start_date: date
    end_date: Optional[date] = None
    reason: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("reason")
    @classmethod
    def _blank_reason(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value else None

    @model_validator(mode="after")
    def _dates_in_order(self) -> "LeaveRequestCreate":
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("The end date must be on or after the start date.")
        return self


class LeaveRequestVoteCreate(BaseModel):
    vote: LeaveVote
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("note")
    @classmethod
    def _blank_note(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value else None


class LeaveRequestVoteResponse(BaseModel):
    voter_id: str
    voter_name: str
    vote: LeaveVote
    # The approver's note; shown to the member and to approvers.
    note: Optional[str] = None
    created_at: datetime


class LeaveRequestResponse(BaseModel):
    id: str
    user_id: str
    member_name: str
    leave_type: LeaveType
    start_date: date
    end_date: Optional[date] = None
    # Present only for the member themself and for those who may decide.
    reason: Optional[str] = None
    status: LeaveRequestStatus
    decision_rule: LeaveDecisionRule
    created_at: datetime
    decided_at: Optional[datetime] = None
    decided_by_name: Optional[str] = None
    leave_id: Optional[str] = None
    votes: List[LeaveRequestVoteResponse] = Field(default_factory=list)
    # The tally against the current approvers, and how many approvals
    # settle it under the rule.
    approvals: int = 0
    denials: int = 0
    approver_count: int = 0
    approvals_needed: int = 0
    # The caller may vote on it now.
    can_vote: bool = False
    my_vote: Optional[LeaveVote] = None
