"""
Shift history import schemas.

snake_case on the wire, like the rest of the scheduling module
(``schemas/scheduling.py`` and ``schemas/external_shift_hours.py`` carry no
alias generator).
"""

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# A review touches one key per distinct person, unit or seat in the file, which
# the 10,000-row cap bounds; this bounds a single request well above that.
_MAX_KEYS_PER_REQUEST = 10_000
_MAX_KEY_LENGTH = 600


def _check_keys(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if value is None:
        return value
    if len(value) > _MAX_KEYS_PER_REQUEST:
        raise ValueError(f"At most {_MAX_KEYS_PER_REQUEST} entries per request.")
    if any(len(k) > _MAX_KEY_LENGTH for k in value):
        raise ValueError("A key is too long.")
    return value


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------


class ShiftHistoryImportSettingsUpdate(BaseModel):
    timezone: Optional[str] = Field(None, max_length=64)
    # ``{field: header}``; a null or empty header unmaps the field.
    column_mapping: Optional[Dict[str, Optional[str]]] = None

    @field_validator("column_mapping")
    @classmethod
    def _bounded(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _check_keys(value)


class ShiftHistoryImportRowUpdate(BaseModel):
    """Omitted fields are left alone. ``match_decision: null`` clears it."""

    # ``{field: value}``; a null value drops the edit, reverting to the cell.
    edits: Optional[Dict[str, Optional[str]]] = None
    excluded: Optional[bool] = None
    match_decision: Optional[Literal["accept", "separate"]] = None
    # Split this row off the entry before it instead of joining the two.
    keep_separate: Optional[bool] = None

    @field_validator("edits")
    @classmethod
    def _bounded_edits(
        cls, value: Optional[Dict[str, Optional[str]]]
    ) -> Optional[Dict[str, Optional[str]]]:
        if value is None:
            return value
        if any(v is not None and len(v) > 255 for v in value.values()):
            raise ValueError("An edited value is longer than 255 characters.")
        return _check_keys(value)


class MemberMapping(BaseModel):
    action: Literal["map", "create"]
    user_id: Optional[str] = Field(None, max_length=36)


class UnitMapping(BaseModel):
    action: Literal["own", "external", "create_external"]
    id: Optional[str] = Field(None, max_length=36)
    agency_name: Optional[str] = Field(None, max_length=255)
    unit_name: Optional[str] = Field(None, max_length=100)


class PositionMapping(BaseModel):
    seat: str = Field(..., min_length=1, max_length=100)


class ShiftHistoryImportMappingsUpdate(BaseModel):
    """Decisions keyed by the source value they resolve; null removes one."""

    members: Optional[Dict[str, Optional[MemberMapping]]] = None
    units: Optional[Dict[str, Optional[UnitMapping]]] = None
    positions: Optional[Dict[str, Optional[PositionMapping]]] = None
    # Proposed-shift key -> whether to add its crew to the probable match
    # already on the schedule.
    existing_shifts: Optional[Dict[str, Optional[Literal["accept", "separate"]]]] = None

    @field_validator("members", "units", "positions", "existing_shifts")
    @classmethod
    def _bounded(cls, value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _check_keys(value)


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------


class ShiftHistoryImportSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    source_filename: str
    timezone: str
    row_count: int
    created_by: Optional[str] = None
    committed_by: Optional[str] = None
    created_at: Optional[datetime] = None
    committed_at: Optional[datetime] = None
    summary: Optional[Dict[str, int]] = None


class ShiftHistoryImportListResponse(BaseModel):
    imports: List[ShiftHistoryImportSummary]


class ImportIssue(BaseModel):
    code: str
    message: str
    blocking: bool
    row_ids: List[str]
    ref: Optional[str] = None


class ImportRowView(BaseModel):
    id: str
    line_number: int
    raw: Dict[str, Any]
    edits: Optional[Dict[str, Any]] = None
    values: Dict[str, str]
    excluded: bool
    match_decision: Optional[str] = None
    keep_separate: bool = False
    skipped_reason: Optional[str] = None
    errors: List[str]
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    local_date: Optional[date] = None
    minutes: Optional[int] = None
    member_key: Optional[str] = None
    unit_key: Optional[str] = None
    position_key: Optional[str] = None
    # Where the row landed: the proposed shift it is part of, or the outside
    # unit entry, and the attendance it was joined into.
    shift_key: Optional[str] = None
    external_key: Optional[str] = None
    attendance_key: Optional[str] = None


class ImportMemberView(BaseModel):
    key: str
    display_name: str
    first_name: str
    last_name: str
    membership_number: str
    email: str
    username: str
    status: str
    user_id: Optional[str] = None
    candidate_ids: List[str]
    reason: str
    row_count: int
    # Settled by a decision remembered from an earlier import.
    remembered: bool = False


class UnitCandidate(BaseModel):
    kind: str
    id: str


class ImportUnitView(BaseModel):
    key: str
    unit: str
    agency: str
    status: str
    target_kind: Optional[str] = None
    target_id: Optional[str] = None
    candidates: List[UnitCandidate]
    new_agency_name: str
    new_unit_name: str
    row_count: int
    # Settled by a decision remembered from an earlier import.
    remembered: bool = False


class ImportPositionView(BaseModel):
    key: str
    source: str
    status: str
    seat: Optional[str] = None
    row_count: int
    # Settled by a decision remembered from an earlier import.
    remembered: bool = False


class ImportAttendanceView(BaseModel):
    key: str
    row_ids: List[str]
    line_numbers: List[int]
    # A user id, or ``new:<member key>`` for a member the commit will create.
    member_ref: str
    unit_kind: str
    unit_ref: str
    seat: str
    role: str
    start: datetime
    end: datetime
    local_date: date
    minutes: int
    call_count: Optional[int] = None
    joined: bool
    confidence: int
    needs_confirmation: bool
    duplicate_existing: bool


class ImportShiftView(BaseModel):
    key: str
    apparatus_id: str
    shift_date: date
    start: datetime
    end: datetime
    existing_shift_id: Optional[str] = None
    existing_confidence: Optional[int] = None
    existing_status: str
    attendances: List[ImportAttendanceView]


class ImportCounts(BaseModel):
    rows: int
    excluded: int
    skipped: int
    with_errors: int
    new_shifts: int
    existing_shifts: int
    attendances: int
    external_entries: int
    duplicates: int


class OptionMember(BaseModel):
    id: str
    name: str
    membership_number: str
    status: str


class OptionUnit(BaseModel):
    kind: str
    id: str
    name: str
    agency_name: Optional[str] = None


class ImportOptions(BaseModel):
    """What a mapping may point at, for the review screen's pickers."""

    members: List[OptionMember]
    units: List[OptionUnit]
    seats: List[str]


class ImportAnalysis(BaseModel):
    can_commit: bool
    blocking_issue_count: int
    counts: ImportCounts
    rows: List[ImportRowView]
    members: List[ImportMemberView]
    units: List[ImportUnitView]
    positions: List[ImportPositionView]
    shifts: List[ImportShiftView]
    external: List[ImportAttendanceView]
    issues: List[ImportIssue]
    options: ImportOptions


class ShiftHistoryImportDetail(BaseModel):
    """A draft with its live analysis, or a committed import's record.

    A committed import carries no analysis: its rows now match the very shifts
    the commit created, so re-analysing it would report every row as a
    duplicate of itself.
    """

    import_: ShiftHistoryImportSummary = Field(..., alias="import")
    headers: List[str]
    column_mapping: Dict[str, str]
    fields: List[str]
    member_mappings: Dict[str, Any]
    unit_mappings: Dict[str, Any]
    position_mappings: Dict[str, Any]
    existing_shift_decisions: Dict[str, Any]
    analysis: Optional[ImportAnalysis] = None

    model_config = ConfigDict(populate_by_name=True)
