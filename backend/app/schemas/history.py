"""
History Module Schemas

snake_case on the wire (no alias generator), matching the module's frontend
types. Two read shapes for a person, chosen by the server per caller:
``HistoricalMemberMemberView`` for a member reading what is published, and
``HistoricalMemberFullView`` for the archive's keepers. The restricted fields
exist only on the second, so they cannot reach a member even as a null.
"""

from datetime import date, datetime
from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, model_validator

from app.models.history import (
    ClearanceDecisionKind,
    ClearancePurpose,
    ClearanceStatus,
    DatePrecision,
    FieldVisibility,
    PublicationLevel,
    RelationType,
    RevisionKind,
    TitleSource,
)

EditKind = Literal["minor", "substantial"]

_NAME = Field(default=None, max_length=100)
_TEXT = Field(default=None, max_length=20000)


# --- Titles ---


class HistoryTitleResponse(BaseModel):
    id: str
    name: str
    source: TitleSource
    sort_order: int
    is_retired: bool
    usage_count: int = 0


class HistoryTitleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class HistoryTitleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    is_retired: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=100000)


class HistoryTitleMerge(BaseModel):
    into_title_id: str


# --- People ---


class ServicePeriodWrite(BaseModel):
    start_date: Optional[date] = None
    start_precision: DatePrecision = DatePrecision.YEAR
    start_circa: bool = False
    end_date: Optional[date] = None
    end_precision: DatePrecision = DatePrecision.YEAR
    end_circa: bool = False
    is_ongoing: bool = False
    notes: Optional[str] = _TEXT
    title_ids: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _consistent(self) -> "ServicePeriodWrite":
        if self.is_ongoing and self.end_date is not None:
            raise ValueError("An ongoing period cannot also have an end date")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("A period cannot end before it starts")
        return self


class ServicePeriodsReplace(BaseModel):
    periods: list[ServicePeriodWrite] = Field(default_factory=list, max_length=50)
    edit_kind: EditKind
    edit_note: Optional[str] = Field(default=None, max_length=2000)


class TitleRef(BaseModel):
    id: str
    name: str


class ServicePeriodResponse(BaseModel):
    id: str
    start_date: Optional[date]
    start_precision: DatePrecision
    start_circa: bool
    end_date: Optional[date]
    end_precision: DatePrecision
    end_circa: bool
    is_ongoing: bool
    notes: Optional[str]
    titles: list[TitleRef]


class _PersonFields(BaseModel):
    """Every editable field. Shared by create and update."""

    first_name: Optional[str] = _NAME
    middle_name: Optional[str] = _NAME
    suffix: Optional[str] = Field(default=None, max_length=20)
    nickname: Optional[str] = _NAME
    badge_number: Optional[str] = Field(default=None, max_length=50)
    birth_date: Optional[date] = None
    birth_date_precision: Optional[DatePrecision] = None
    birth_date_circa: Optional[bool] = None
    biography: Optional[str] = _TEXT
    addresses: Optional[str] = _TEXT
    verification_sources: Optional[str] = _TEXT
    research_notes: Optional[str] = _TEXT
    is_memorial: Optional[bool] = None
    is_line_of_duty_death: Optional[bool] = None
    death_date: Optional[date] = None
    death_date_precision: Optional[DatePrecision] = None
    death_date_circa: Optional[bool] = None
    death_date_visibility: Optional[FieldVisibility] = None
    death_circumstances: Optional[str] = _TEXT
    death_circumstances_visibility: Optional[FieldVisibility] = None
    burial_location: Optional[str] = Field(default=None, max_length=2000)
    burial_location_visibility: Optional[FieldVisibility] = None


class HistoricalMemberCreate(_PersonFields):
    last_name: str = Field(min_length=1, max_length=100)
    user_id: Optional[str] = None


class HistoricalMemberUpdate(_PersonFields):
    last_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    user_id: Optional[str] = None
    edit_kind: EditKind
    edit_note: Optional[str] = Field(default=None, max_length=2000)


class RelationResponse(BaseModel):
    id: str
    other_member_id: str
    other_display_name: str
    #: How the other person relates to this one: "parent", "child", ...
    relationship: str


class RelationCreate(BaseModel):
    related_member_id: str
    #: Read from the person in the path: they are ``parent_of`` the other.
    relation_type: RelationType
    label: Optional[str] = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _label_for_other(self) -> "RelationCreate":
        if self.relation_type == RelationType.OTHER and not (self.label or "").strip():
            raise ValueError("Describe the relationship")
        return self


class HistoricalMemberSummary(BaseModel):
    id: str
    display_name: str
    last_name: str
    first_name: Optional[str]
    nickname: Optional[str]
    service_years: Optional[str]
    titles: list[str]
    is_memorial: bool
    is_line_of_duty_death: bool
    publication_level: PublicationLevel


class HistoricalMemberList(BaseModel):
    items: list[HistoricalMemberSummary]
    total: int


class HistoricalMemberMemberView(BaseModel):
    """What a member reading published history receives."""

    view: Literal["member"] = "member"
    id: str
    display_name: str
    first_name: Optional[str]
    middle_name: Optional[str]
    last_name: str
    suffix: Optional[str]
    nickname: Optional[str]
    badge_number: Optional[str]
    biography_html: Optional[str]
    is_memorial: bool
    is_line_of_duty_death: bool
    # Memorial fields appear only where their own visibility allows.
    death_date: Optional[date] = None
    death_date_precision: Optional[DatePrecision] = None
    death_date_circa: Optional[bool] = None
    death_circumstances: Optional[str] = None
    burial_location: Optional[str] = None
    service_periods: list[ServicePeriodResponse]
    relations: list[RelationResponse]
    publication_level: PublicationLevel


class ClearanceStepState(BaseModel):
    index: int
    name: str
    position_id: Optional[str]
    position_name: Optional[str]
    blocked: bool
    decision: Optional[ClearanceDecisionKind] = None
    decided_by_name: Optional[str] = None
    decided_by_author: bool = False
    note: Optional[str] = None
    decided_at: Optional[datetime] = None


class ClearanceRequestResponse(BaseModel):
    id: str
    record_type: str
    record_id: str
    record_label: str
    revision_number: int
    purpose: ClearancePurpose
    status: ClearanceStatus
    current_step_index: int
    steps: list[ClearanceStepState]
    submitted_by_name: Optional[str]
    submitted_at: datetime
    closed_at: Optional[datetime]
    can_decide: bool = False


class HistoricalMemberFullView(BaseModel):
    """What the archive's keepers receive: every field, drafts included."""

    view: Literal["full"] = "full"
    id: str
    display_name: str
    user_id: Optional[str]
    linked_member_name: Optional[str]
    first_name: Optional[str]
    middle_name: Optional[str]
    last_name: str
    suffix: Optional[str]
    nickname: Optional[str]
    badge_number: Optional[str]
    birth_date: Optional[date]
    birth_date_precision: DatePrecision
    birth_date_circa: bool
    biography: Optional[str]
    biography_html: Optional[str]
    addresses: Optional[str]
    verification_sources: Optional[str]
    research_notes: Optional[str]
    is_memorial: bool
    is_line_of_duty_death: bool
    death_date: Optional[date]
    death_date_precision: DatePrecision
    death_date_circa: bool
    death_date_visibility: FieldVisibility
    death_circumstances: Optional[str]
    death_circumstances_visibility: FieldVisibility
    burial_location: Optional[str]
    burial_location_visibility: FieldVisibility
    service_periods: list[ServicePeriodResponse]
    relations: list[RelationResponse]
    publication_level: PublicationLevel
    published_at: Optional[datetime]
    revision_number: int
    public_revision_number: Optional[int]
    #: A substantial edit has not yet been cleared for the public.
    public_changes_pending: bool
    #: The department has a clearance list, so the public needs one passed.
    clearance_required: bool
    #: The record's latest substantial revision may be published publicly now.
    cleared_for_public: bool
    clearance: Optional[ClearanceRequestResponse]
    can_edit: bool
    can_publish: bool
    created_at: datetime
    updated_at: datetime


HistoricalMemberView = Union[HistoricalMemberFullView, HistoricalMemberMemberView]


class PersonWarning(BaseModel):
    kind: Literal["badge_number", "possible_duplicate"]
    message: str
    member_id: str
    display_name: str
    service_years: Optional[str]


class PersonCheck(BaseModel):
    warnings: list[PersonWarning]


class PublishRequest(BaseModel):
    level: Literal["members", "public"]


class UnpublishRequest(BaseModel):
    level: Literal["draft", "members"]


class RevisionResponse(BaseModel):
    id: str
    revision_number: int
    kind: RevisionKind
    note: Optional[str]
    actor_name: Optional[str]
    created_at: datetime


class HonorRollEntry(BaseModel):
    id: str
    display_name: str
    titles: list[str]
    service_years: Optional[str]
    death_date: Optional[date]
    death_date_precision: Optional[DatePrecision]
    death_date_circa: Optional[bool]
    death_circumstances: Optional[str]


# --- Clearance list ---


class ClearanceStepWrite(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    position_id: str


class ClearanceStepsReplace(BaseModel):
    steps: list[ClearanceStepWrite] = Field(default_factory=list, max_length=20)


class ClearanceStepResponse(BaseModel):
    id: str
    step_order: int
    name: str
    position_id: Optional[str]
    position_name: Optional[str]
    blocked: bool


class PositionOption(BaseModel):
    id: str
    name: str


class ClearanceSubmit(BaseModel):
    record_type: Literal["member"]
    record_id: str
    purpose: ClearancePurpose = ClearancePurpose.PUBLIC


class ClearanceDecide(BaseModel):
    decision: ClearanceDecisionKind
    note: Optional[str] = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _return_needs_note(self) -> "ClearanceDecide":
        if (
            self.decision == ClearanceDecisionKind.RETURNED
            and not (self.note or "").strip()
        ):
            raise ValueError("Say what needs to change when returning a record")
        return self


class ClearanceReview(BaseModel):
    """A request with the record as members would read it, for its reviewers."""

    request: ClearanceRequestResponse
    record: HistoricalMemberMemberView


class MarkdownRender(BaseModel):
    markdown: str = Field(default="", max_length=20000)


class MarkdownRendered(BaseModel):
    html: str
