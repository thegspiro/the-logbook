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

from app.models.leave_request import (
    LeaveDecisionRule,
    LeaveMessageKind,
    LeaveRequestStatus,
    LeaveVote,
)
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
    # A request still undecided this many days after it was made is sent,
    # once, to the Chief (or, when no Chief can open it, the officers who
    # manage leave). 0 sends none.
    request_escalation_days: int = Field(default=21, ge=0, le=180)

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


class LeaveQuestionCreate(BaseModel):
    """An approver's question, or the member's answer."""

    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Write something first.")
        return value


class LeaveChangesCreate(BaseModel):
    """An approver's changed dates, for the member to accept or decline."""

    start_date: date
    end_date: Optional[date] = None
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("note")
    @classmethod
    def _blank_note(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value else None

    @model_validator(mode="after")
    def _dates_in_order(self) -> "LeaveChangesCreate":
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("The end date must be on or after the start date.")
        return self


class LeaveChangesResponse(BaseModel):
    """The member's answer to changed dates."""

    accept: bool
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("note")
    @classmethod
    def _blank_note(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() or None if value else None


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
    # The voting round it was cast in; only the request's current round counts.
    round: int = 1
    vote: LeaveVote
    # The away approver a stand-in voted in place of; empty for a vote an
    # approver cast for themselves.
    on_behalf_of_name: Optional[str] = None
    # The approver's note; shown to the member and to approvers.
    note: Optional[str] = None
    created_at: datetime


class LeaveRequestMessageResponse(BaseModel):
    kind: LeaveMessageKind
    author_name: str
    body: Optional[str] = None
    created_at: datetime


class LeaveDates(BaseModel):
    start_date: date
    end_date: Optional[date] = None


class LeaveProposalResponse(LeaveDates):
    proposed_by_name: str
    proposed_at: datetime


class LeaveRequestSummary(BaseModel):
    """What the navigation needs: whether to offer the page, and a count."""

    requests_enabled: bool
    # Waiting requests the caller may vote on now and has not.
    to_decide: int
    # The caller's own requests waiting on their answer.
    waiting_on_me: int


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
    # The active leave this request extends, as it stands.
    extends_leave: Optional[LeaveDates] = None
    # "answer" or "proposal" while the request waits on its member.
    awaiting: Optional[str] = None
    proposal: Optional[LeaveProposalResponse] = None
    # Shown to the member and those who may decide, like the reason.
    messages: List[LeaveRequestMessageResponse] = Field(default_factory=list)
    vote_round: int = 1
    votes: List[LeaveRequestVoteResponse] = Field(default_factory=list)
    # The tally against the current approvers, and how many approvals
    # settle it under the rule.
    approvals: int = 0
    denials: int = 0
    approver_count: int = 0
    approvals_needed: int = 0
    # The member held an approver position when they asked, so the Chief
    # decides it rather than their fellow approvers.
    routed_to_chief: bool = False
    # The caller may vote on it now.
    can_vote: bool = False
    # The caller may ask a question or propose changed dates now.
    can_ask: bool = False
    # The caller is the member and owes an answer, or a decision on dates.
    can_answer: bool = False
    can_respond_to_changes: bool = False
    my_vote: Optional[LeaveVote] = None


class LeaveEndEarlyCreate(BaseModel):
    """A member's first day back from their own leave in progress."""

    first_day_back: date


class LeaveEndedEarlyResponse(BaseModel):
    leave_id: str
    start_date: date
    # The leave's last day now: the day before the first day back.
    end_date: date
    previous_end_date: Optional[date] = None
    first_day_back: date


class LeaveApproverCoverCreate(BaseModel):
    """An approver's away period and the officer standing in for them."""

    approver_id: str = Field(..., min_length=1, max_length=36)
    stand_in_id: str = Field(..., min_length=1, max_length=36)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _dates(self) -> "LeaveApproverCoverCreate":
        if self.end_date < self.start_date:
            raise ValueError("The cover must end on or after the day it starts.")
        if self.stand_in_id == self.approver_id:
            raise ValueError("An approver cannot stand in for themself.")
        return self


class LeaveApproverCoverResponse(BaseModel):
    id: str
    approver_id: str
    approver_name: str
    stand_in_id: str
    stand_in_name: str
    start_date: date
    end_date: date
    # Running today, in the department's timezone.
    active: bool
    can_clear: bool


class LeaveCoverPerson(BaseModel):
    id: str
    name: str


class LeaveApproverCoverBoard(BaseModel):
    """The covers the caller may see, and whom they may set one for."""

    covers: List[LeaveApproverCoverResponse] = Field(default_factory=list)
    # Approvers the caller may set a cover for: themself if they are one,
    # every approver for those who manage leave.
    approvers: List[LeaveCoverPerson] = Field(default_factory=list)
    # Who may stand in: the members who manage leave.
    stand_ins: List[LeaveCoverPerson] = Field(default_factory=list)
    today: date
