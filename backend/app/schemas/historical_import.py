"""
Historical data import schemas.

snake_case on the wire, like the shift history import whose batches this
creates (``schemas/shift_history_import.py`` carries no alias generator).
"""

from datetime import date
from datetime import date as CalendarDate
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.shift_history_import import MemberMapping

# One key per column of the file; no real export has more.
_MAX_KEYS = 500
_MAX_KEY_LENGTH = 255


def _bounded(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    if len(value) > _MAX_KEYS:
        raise ValueError(f"At most {_MAX_KEYS} entries per request.")
    if any(len(k) > _MAX_KEY_LENGTH for k in value):
        raise ValueError("A key is too long.")
    if any(v is not None and len(str(v)) > _MAX_KEY_LENGTH for v in value.values()):
        raise ValueError("A value is too long.")
    return value


class HistoricalImportSettingsUpdate(BaseModel):
    """Omitted fields are left alone. Within a mapping, a null or empty value
    unmaps that key."""

    source_system: Optional[str] = Field(None, min_length=1, max_length=100)
    timezone: Optional[str] = Field(None, max_length=64)
    # ``{field: header}``
    column_mapping: Optional[Dict[str, Optional[str]]] = None
    # ``{header: record type}``; ``ignore`` or null drops the column.
    hour_columns: Optional[Dict[str, Optional[str]]] = None
    # ``{header: call type slug}``
    call_columns: Optional[Dict[str, Optional[str]]] = None

    @field_validator("column_mapping", "hour_columns", "call_columns")
    @classmethod
    def _check(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _bounded(value)


class HistoricalImportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    source_filename: str
    source_system: str
    timezone: str
    row_count: int
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    routed_at: Optional[datetime] = None


class HistoricalImportListResponse(BaseModel):
    imports: List[HistoricalImportSummary]


class RoutingTypeTotals(BaseModel):
    records: int
    hours: float
    first_date: Optional[date] = None
    last_date: Optional[date] = None


class RoutingError(BaseModel):
    line_number: int
    messages: List[str]


class RoutingNoteExample(BaseModel):
    line_number: int
    message: str


class RoutingNote(BaseModel):
    count: int
    examples: List[RoutingNoteExample]


class RoutingSummary(BaseModel):
    rows: int
    skipped: int
    with_errors: int
    # The first rows with a problem; ``with_errors`` is the full count.
    errors: List[RoutingError]
    # Clean-up applied, by kind (``hours_differ``, ``next_day``).
    notes: Dict[str, RoutingNote]
    types: Dict[str, RoutingTypeTotals]


class ShiftBatchView(BaseModel):
    id: str
    status: str
    source_filename: str
    row_count: int
    created_at: Optional[datetime] = None
    committed_at: Optional[datetime] = None
    summary: Optional[Dict[str, int]] = None


class CallTypeOption(BaseModel):
    slug: str
    label: str


class HistoricalImportDetail(BaseModel):
    import_: HistoricalImportSummary = Field(..., alias="import")
    headers: List[str]
    column_mapping: Dict[str, str]
    hour_columns: Dict[str, str]
    call_columns: Dict[str, str]
    fields: List[str]
    record_types: List[str]
    # The record types this release can send on to an import.
    importable_types: List[str]
    call_types: List[CallTypeOption]
    routing: RoutingSummary
    # Source rows this import's committed batches have written.
    rows_imported: int
    batches: List[ShiftBatchView]
    # True while a shift batch is in review; settings cannot change then.
    settings_locked: bool

    model_config = ConfigDict(populate_by_name=True)


class ShiftBatchesCreated(BaseModel):
    batches: List[ShiftBatchView]


class OpenBatchesDiscarded(BaseModel):
    discarded: int


# ---------------------------------------------------------------------------
# Administrative hours
# ---------------------------------------------------------------------------


class FlagCategoryRule(BaseModel):
    column: str = Field(..., min_length=1, max_length=_MAX_KEY_LENGTH)
    category_id: str = Field(..., min_length=1, max_length=36)


class AdminSettingsUpdate(BaseModel):
    """The whole administrative setup, replacing what was stored."""

    description_columns: List[str] = Field(default_factory=list, max_length=_MAX_KEYS)
    # Applied in this order; the first rule whose column is set wins.
    flag_categories: List[FlagCategoryRule] = Field(
        default_factory=list, max_length=_MAX_KEYS
    )
    default_categories: Dict[str, str] = Field(default_factory=dict)

    @field_validator("default_categories")
    @classmethod
    def _check(cls, value: Dict[str, str]) -> Dict[str, str]:
        checked = _bounded(value)
        return checked if checked is not None else {}


class MemberMappingsUpdate(BaseModel):
    """Who each member is, by member key; ``null`` removes a decision."""

    members: Dict[str, Optional[MemberMapping]]

    @field_validator("members")
    @classmethod
    def _check(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if len(value) > 10_000:
            raise ValueError("At most 10000 entries per request.")
        if any(len(k) > 600 for k in value):
            raise ValueError("A key is too long.")
        return value


class AdminCategoryOption(BaseModel):
    id: str
    name: str
    is_active: bool


class AdminCategoryTotals(BaseModel):
    category_id: Optional[str] = None
    name: str
    records: int
    hours: float


class AdminMember(BaseModel):
    key: str
    display_name: str
    membership_number: str
    # unmatched | conflict | ambiguous | create
    status: str
    reason: str
    candidate_ids: List[str]
    new_first_name: str = ""
    new_last_name: str = ""
    row_count: int


class AdminMemberOption(BaseModel):
    id: str
    name: str
    membership_number: str
    status: str


class AdminSettingsView(BaseModel):
    description_columns: List[str]
    flag_categories: List[FlagCategoryRule]
    default_categories: Dict[str, str]


class AdminPreview(BaseModel):
    settings: AdminSettingsView
    categories: List[AdminCategoryOption]
    # Administrative records not yet imported, and those already in the ledger.
    pending_records: int
    already_imported: int
    by_category: List[AdminCategoryTotals]
    # Records no rule or default places in a category; block the commit.
    uncategorized: int
    # Records with more than one flag rule set, settled by the rule order.
    flag_conflicts: int
    problems: List[str]
    problem_count: int
    # Members still to decide, and members the commit will create.
    members: List[AdminMember]
    member_options: List[AdminMemberOption]
    can_commit: bool
    # What the last administrative commit wrote, once there has been one.
    result: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


class TrainingSettingsUpdate(BaseModel):
    """Omitted fields are left alone. ``subject_courses`` is merged by subject
    key; a null course removes that subject's mapping."""

    subject_column: Optional[str] = Field(None, max_length=_MAX_KEY_LENGTH)
    instructor_column: Optional[str] = Field(None, max_length=_MAX_KEY_LENGTH)
    taught_column: Optional[str] = Field(None, max_length=_MAX_KEY_LENGTH)
    provider_patterns: Optional[List[str]] = Field(None, max_length=20)
    unmatched_provider_action: Optional[Literal["import", "skip"]] = None
    subject_courses: Optional[Dict[str, Optional[str]]] = None
    drill_column: Optional[str] = Field(None, max_length=_MAX_KEY_LENGTH)
    # Session-attendance requirements the drills count toward; replaces the set.
    drill_requirement_ids: Optional[List[str]] = Field(None, max_length=50)
    drill_min_members: Optional[int] = Field(None, ge=1, le=50)

    @field_validator("subject_courses")
    @classmethod
    def _check(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if value is None:
            return value
        if len(value) > 20_000:
            raise ValueError("At most 20000 entries per request.")
        if any(len(k) > 600 for k in value):
            raise ValueError("A key is too long.")
        return value


class TrainingSettingsView(BaseModel):
    subject_column: str
    instructor_column: str
    taught_column: str
    provider_patterns: List[str]
    unmatched_provider_action: Optional[str] = None
    subject_courses: Dict[str, str]
    drill_column: str = ""
    drill_requirement_ids: List[str] = Field(default_factory=list)
    drill_min_members: int = 3


class TrainingSubject(BaseModel):
    # Normalized subject: one mapping decision per key.
    key: str
    # A spelling of it as the file has it.
    subject: str
    records: int
    hours: float
    course_id: Optional[str] = None
    course_name: str = ""
    suggested_course_id: Optional[str] = None


class TrainingCourseOption(BaseModel):
    id: str
    name: str
    training_type: str


class TrainingPreview(BaseModel):
    settings: TrainingSettingsView
    headers: List[str]
    pending_records: int
    already_imported: int
    # Rows whose instructor names a training provider, split by whether a
    # synced record already covers them.
    provider_rows: int
    provider_matched: int
    provider_unmatched: int
    subject_count: int
    subjects_mapped: int
    records_mapped: int
    # One page of subjects, most records first, filtered by ``search``.
    subjects: List[TrainingSubject]
    subject_total: int
    courses: List[TrainingCourseOption]
    problems: List[str]
    problem_count: int
    members: List[AdminMember]
    member_options: List[AdminMemberOption]
    can_commit: bool
    result: Optional[Dict[str, Any]] = None


class DrillDate(BaseModel):
    date: date
    members: int
    # The session the import created for it, once it has.
    session_created: bool


class DrillRequirementOption(BaseModel):
    id: str
    name: str
    required_attendance_pct: Optional[float] = None


class DrillPreview(BaseModel):
    """CompanyDrill rows, by date: which dates become held drills."""

    settings: TrainingSettingsView
    headers: List[str]
    drill_rows: int
    drill_dates: int
    # Dates with at least ``drill_min_members`` members: these become sessions.
    qualifying_dates: int
    qualifying_rows: int
    sessions_created: int
    # One page of qualifying dates, newest first.
    dates: List[DrillDate]
    requirements: List[DrillRequirementOption]
    # The drills attach the training records the training step wrote.
    training_committed: bool
    can_commit: bool
    result: Optional[Dict[str, Any]] = None


class SuggestionsAccepted(BaseModel):
    mapped: int


# ---------------------------------------------------------------------------
# Staffing roster
# ---------------------------------------------------------------------------

StaffingFileKind = Literal["seats", "events"]


class StaffingMappingUpdate(BaseModel):
    """The whole mapping for one file, replacing what was stored. A null or
    empty header leaves that field unmapped."""

    column_mapping: Dict[str, Optional[str]]

    @field_validator("column_mapping")
    @classmethod
    def _check(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        checked = _bounded(value)
        return checked if checked is not None else {}


class StaffingFileView(BaseModel):
    kind: StaffingFileKind
    source_filename: str
    headers: List[str]
    column_mapping: Dict[str, str]
    row_count: int
    created_at: Optional[datetime] = None


class StaffingMissingEvent(BaseModel):
    event_key: str
    seats: int


class StaffingSeatSummary(BaseModel):
    rows: int
    filled: int
    unfilled: int
    without_event_key: int
    # Seats whose event key the events file does not have: no date to place
    # them on.
    missing_event: int
    missing_event_filled: int
    missing_event_keys: int
    missing_event_examples: List[StaffingMissingEvent]


class StaffingUnusualEvent(BaseModel):
    line_number: int
    date: date
    activity: str
    seats: int


class StaffingEventSummary(BaseModel):
    rows: int
    staffed: int
    unstaffed: int
    # Unstaffed events with a date in the usual range: these become calendar
    # events (scheduled ones when upcoming).
    unstaffed_importable: int
    undated: int
    undated_examples: List[int]
    # The years most of the file's events fall in; an event outside them is
    # flagged as a possible test entry.
    usual_first_year: Optional[int] = None
    usual_last_year: Optional[int] = None
    outside_usual_range: int
    outside_usual_range_examples: List[StaffingUnusualEvent]
    upcoming: int
    overnight: int
    duplicate_keys: int
    first_date: Optional[date] = None
    last_date: Optional[date] = None


class StaffingSummary(BaseModel):
    seats: StaffingSeatSummary
    events: StaffingEventSummary


class StaffingPreview(BaseModel):
    files: List[StaffingFileView]
    # The fields each kind of file can map, in display order.
    fields: Dict[str, List[str]]
    # True when the seats file carries its events' dates and no events file
    # is needed.
    flat_file: bool
    # What must be chosen before the files can be read together.
    problems: List[str]
    summary: Optional[StaffingSummary] = None


StaffingMappingList = Literal["activities", "seat_titles", "event_titles"]


class StaffingDecisionsUpdate(BaseModel):
    """Decisions merged into one list, by key; a null clears that key."""

    decisions: Dict[str, Optional[str]]

    @field_validator("decisions")
    @classmethod
    def _check(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if len(value) > 5_000:
            raise ValueError("At most 5000 entries per request.")
        if any(len(k) > 200 for k in value):
            raise ValueError("A key is too long.")
        if any(v is not None and len(str(v)) > 100 for v in value.values()):
            raise ValueError("A value is too long.")
        return value


class StaffingMappingItem(BaseModel):
    key: str
    label: str
    seats: int
    events: int
    suggestion: Optional[str] = None
    choice: Optional[str] = None
    # A few spellings of a title sharing this key.
    examples: List[str] = Field(default_factory=list)


class StaffingMappingProgress(BaseModel):
    items: int
    decided: int
    suggested: int
    undecided: int
    seats: int
    seats_settled: int


class StaffingChoice(BaseModel):
    value: str
    label: str


class StaffingMappingView(BaseModel):
    list: StaffingMappingList
    # One page of the list, most seats first, filtered by ``search``.
    items: List[StaffingMappingItem]
    total: int
    progress: Dict[str, StaffingMappingProgress]
    # The department's crew seats and outreach roles: the only values a title
    # may take, besides attendance (events) and leaving it out.
    seat_choices: List[StaffingChoice]
    role_choices: List[StaffingChoice]


class StaffingCommitPreview(BaseModel):
    """What writing the roster would do, and what it leaves out."""

    # shifts, shift_seats, events, upcoming_events, check_ins, outreach_seats,
    # assigned_unfilled
    counts: Dict[str, int]
    # Seats left out, by reason (no_event, undated, outside_usual_range,
    # activity_left_out, activity_undecided, title_left_out, title_undecided,
    # unfilled).
    skipped: Dict[str, int]
    unfilled_seats: int
    include_unstaffed: bool
    members: List[AdminMember]
    member_options: List[AdminMemberOption]
    can_commit: bool
    result: Optional[Dict[str, Any]] = None


class StaffingOptionsUpdate(BaseModel):
    include_unstaffed: bool


class StaffingUnfilledSeat(BaseModel):
    line_number: int
    # Annotated through an alias: a field named ``date`` with a default
    # shadows the type inside the class body, and pydantic would then accept
    # only None.
    date: Optional[CalendarDate] = None
    activity: str
    title: str
    # The department's seat, role or attendance the title maps to.
    maps_to: str
    required: bool
    assigned_user_id: Optional[str] = None


class StaffingUnfilledView(BaseModel):
    items: List[StaffingUnfilledSeat]
    total: int
    assigned: int
    member_options: List[AdminMemberOption]


class StaffingUnfilledUpdate(BaseModel):
    """Members for unfilled seats, by seat line; a null empties the seat."""

    assignments: Dict[str, Optional[str]]

    @field_validator("assignments")
    @classmethod
    def _check(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if len(value) > 2_000:
            raise ValueError("At most 2000 entries per request.")
        if any(len(k) > 10 for k in value):
            raise ValueError("A seat is named by its line number.")
        if any(v is not None and len(str(v)) > 36 for v in value.values()):
            raise ValueError("A member id is too long.")
        return value
