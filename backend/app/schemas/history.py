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
    AlbumLevel,
    ApparatusDisposition,
    ClearanceDecisionKind,
    ClearancePurpose,
    ClearanceStatus,
    DatePrecision,
    DocumentKind,
    FieldVisibility,
    HistoryImportDecision,
    HistoryImportStatus,
    HistoryTitleAction,
    MediaKind,
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
    #: Whether a dated start of this title reaches the department timeline.
    #: Off unless the Historian turns it on (owner decision 9, phase 5).
    show_on_timeline: bool = False
    usage_count: int = 0


class HistoryTitleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class HistoryTitleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    is_retired: Optional[bool] = None
    show_on_timeline: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=100000)


class HistoryTitleMerge(BaseModel):
    into_title_id: str


# --- People ---


class HeldTitleWrite(BaseModel):
    """A title held in a service period, with the dates it was held when
    they are known. A title's start is placed on a timeline only by these
    dates, never by the period's."""

    title_id: str = Field(max_length=36)
    held_from_date: Optional[date] = None
    held_from_precision: DatePrecision = DatePrecision.YEAR
    held_from_circa: bool = False
    held_to_date: Optional[date] = None
    held_to_precision: DatePrecision = DatePrecision.YEAR
    held_to_circa: bool = False

    @model_validator(mode="after")
    def _consistent(self) -> "HeldTitleWrite":
        if (
            self.held_from_date
            and self.held_to_date
            and self.held_to_date < self.held_from_date
        ):
            raise ValueError("A title cannot end before it was first held")
        return self


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
    #: The titles with their dates. When sent, it is used instead of
    #: ``title_ids``; a caller that sends only ``title_ids`` gets undated
    #: titles, as before phase 5.
    titles: Optional[list[HeldTitleWrite]] = Field(default=None, max_length=50)

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
    held_from_date: Optional[date] = None
    held_from_precision: DatePrecision = DatePrecision.YEAR
    held_from_circa: bool = False
    held_to_date: Optional[date] = None
    held_to_precision: DatePrecision = DatePrecision.YEAR
    held_to_circa: bool = False


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
    #: The merged-away id this request named, when it was forwarded here.
    redirected_from: Optional[str] = None


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
    #: Set when the record was created by an import.
    import_id: Optional[str] = None
    #: The merged-away id this request named, when it was forwarded here.
    redirected_from: Optional[str] = None


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
    record_type: Literal["member", "media", "document", "apparatus", "event"]
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
    #: A person, a photo/media item, a document, an apparatus or an event, as
    #: members would read it; which one is ``request.record_type``.
    record: Union[
        HistoricalMemberMemberView,
        "MediaMemberView",
        "DocumentMemberView",
        "ApparatusMemberView",
        "EventMemberView",
    ]


class MarkdownRender(BaseModel):
    markdown: str = Field(default="", max_length=20000)


class MarkdownRendered(BaseModel):
    html: str


# ----------------------------------------------------------------------
# Import
# ----------------------------------------------------------------------


class HistoryImportSummary(BaseModel):
    id: str
    status: HistoryImportStatus
    source_filename: str
    row_count: int
    #: {field: header} the import read each column from.
    column_mapping: dict[str, str]
    #: Counts after commit: created, mapped, matched, repeats, skipped, removed.
    summary: Optional[dict[str, int]]
    expires_at: Optional[datetime]
    created_at: datetime
    committed_at: Optional[datetime]


class ImportSuggestion(BaseModel):
    kind: Literal["match", "map", "same_as"]
    id: str
    strength: Literal["strong", "weak"]
    label: str


class ImportRowView(BaseModel):
    id: str
    line_number: int
    #: The file's values with the Historian's corrections applied.
    values: dict[str, str]
    edited_fields: list[str]
    problems: list[str]
    decision: Optional[HistoryImportDecision]
    target_member_id: Optional[str]
    target_user_id: Optional[str]
    target_row_id: Optional[str]
    target_label: Optional[str]
    suggestions: list[ImportSuggestion]


class ImportTitleView(BaseModel):
    text: str
    key: str
    #: known: already on the list; mapped / create / dropped: answered;
    #: unresolved: waiting for the Historian.
    status: Literal["known", "mapped", "create", "dropped", "unresolved"]
    title_id: Optional[str] = None


class HistoryImportDetail(HistoryImportSummary):
    rows: list[ImportRowView]
    titles: list[ImportTitleView]
    ready: bool
    #: Why a commit would be refused right now, one line each.
    blockers: list[str]


class ImportRowUpdate(BaseModel):
    """A correction to the row's values, a decision, or both."""

    #: {field: text}; an empty string clears the file's value.
    edits: Optional[dict[str, str]] = None
    decision: Optional[HistoryImportDecision] = None
    target_member_id: Optional[str] = None
    target_user_id: Optional[str] = None
    target_row_id: Optional[str] = None

    @model_validator(mode="after")
    def _edits_are_short(self) -> "ImportRowUpdate":
        for key, value in (self.edits or {}).items():
            if len(key) > 50 or len(value or "") > 2000:
                raise ValueError("A corrected value is too long")
        return self


class ImportTitleChoice(BaseModel):
    text: str = Field(min_length=1, max_length=150)
    action: HistoryTitleAction
    title_id: Optional[str] = None

    @model_validator(mode="after")
    def _map_names_a_title(self) -> "ImportTitleChoice":
        if self.action == HistoryTitleAction.MAP and not self.title_id:
            raise ValueError("Choose the title to use")
        return self


class ImportTitlesUpdate(BaseModel):
    choices: list[ImportTitleChoice] = Field(max_length=500)


class AcceptSuggestionsResult(BaseModel):
    decided: int


class RemovedRecord(BaseModel):
    id: str
    display_name: str
    reason: str


class RemoveRecordsResult(BaseModel):
    removed: int
    kept: list[RemovedRecord]


# ----------------------------------------------------------------------
# Merge
# ----------------------------------------------------------------------


class MergeSide(BaseModel):
    id: str
    display_name: str
    service_years: Optional[str]
    publication_level: PublicationLevel
    period_count: int
    relation_count: int
    linked_member_name: Optional[str]
    is_memorial: bool
    is_line_of_duty_death: bool


class MergeField(BaseModel):
    field: str
    label: str
    keep_value: Optional[str]
    other_value: Optional[str]
    #: same / keep_blank / other_blank need no choice; differs does.
    state: Literal["same", "keep_blank", "other_blank", "differs"]
    can_keep_both: bool


class MergePreview(BaseModel):
    keep: MergeSide
    other: MergeSide
    fields: list[MergeField]
    #: Why this pair cannot be merged, when it cannot.
    refusal: Optional[str]
    warnings: list[str]


class MergeRequest(BaseModel):
    other_id: str = Field(min_length=1, max_length=36)
    #: {field: "keep" | "other" | "both"} for each field that differs.
    choices: dict[str, Literal["keep", "other", "both"]] = Field(default_factory=dict)


# ----------------------------------------------------------------------
# Shared by photos, documents and the phase 5 records
# ----------------------------------------------------------------------


class ApparatusTag(BaseModel):
    """An apparatus a photo, document or event is linked to. Only apparatus
    the caller may read are listed."""

    apparatus_id: str
    name: str


class EventSummary(BaseModel):
    id: str
    title: str
    start_date: date
    start_precision: DatePrecision
    start_circa: bool
    end_date: Optional[date]
    end_precision: DatePrecision
    end_circa: bool
    place: Optional[str]
    station_name: Optional[str]
    event_type_name: Optional[str]
    publication_level: PublicationLevel


class ApparatusTagsReplace(BaseModel):
    apparatus_ids: list[str] = Field(max_length=200)


# ----------------------------------------------------------------------
# Photos and media
# ----------------------------------------------------------------------

ConsentState = Literal["granted", "declined", "not_answered", "no_account"]


class MediaTagMember(BaseModel):
    member_id: str
    display_name: str


class MediaTagFull(MediaTagMember):
    #: The tagged person's photo-use answer, read from their linked account.
    #: A warning for the archive's keepers only; it never blocks.
    consent: ConsentState


class _MediaCatalogue(BaseModel):
    id: str
    kind: MediaKind
    title: str
    description: Optional[str]
    taken_date: Optional[date]
    taken_date_precision: DatePrecision
    taken_date_circa: bool
    place: Optional[str]
    creator: Optional[str]
    source_id: Optional[str]
    source_name: Optional[str]
    rights_note: Optional[str]
    accession_number: Optional[str]
    original_location: Optional[str]
    width: Optional[int]
    height: Optional[int]
    duration_seconds: Optional[int]
    has_thumbnail: bool
    #: The type of what ``/view`` returns: the WebP viewing copy of a photo,
    #: or the stripped copy of a recording (same container as the original).
    mime_type: Optional[str]
    publication_level: PublicationLevel
    apparatus: list[ApparatusTag] = Field(default_factory=list)
    #: The events this item belongs to that the caller may read.
    events: list[EventSummary] = Field(default_factory=list)


class MediaMemberView(_MediaCatalogue):
    """What a member reading published history receives: no research notes,
    no original file, and tags only for people they may read."""

    view: Literal["member"] = "member"
    tags: list[MediaTagMember]


class MediaFullView(_MediaCatalogue):
    view: Literal["full"] = "full"
    research_notes: Optional[str]
    original_filename: str
    original_mime_type: Optional[str]
    original_size_bytes: Optional[int]
    original_sha256: Optional[str]
    batch_id: Optional[str]
    tags: list[MediaTagFull]
    published_at: Optional[datetime]
    revision_number: int
    public_revision_number: Optional[int]
    public_changes_pending: bool
    clearance_required: bool
    cleared_for_public: bool
    clearance: Optional[ClearanceRequestResponse]
    can_edit: bool
    can_publish: bool
    created_at: datetime
    updated_at: datetime


MediaView = Union[MediaFullView, MediaMemberView]


class MediaSummary(BaseModel):
    id: str
    kind: MediaKind
    title: str
    taken_date: Optional[date]
    taken_date_precision: DatePrecision
    taken_date_circa: bool
    duration_seconds: Optional[int]
    has_thumbnail: bool
    publication_level: PublicationLevel


class MediaList(BaseModel):
    items: list[MediaSummary]
    total: int


class _MediaFields(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = _TEXT
    taken_date: Optional[date] = None
    taken_date_precision: Optional[DatePrecision] = None
    taken_date_circa: Optional[bool] = None
    place: Optional[str] = Field(default=None, max_length=255)
    creator: Optional[str] = Field(default=None, max_length=255)
    source_id: Optional[str] = Field(default=None, max_length=36)
    rights_note: Optional[str] = _TEXT
    accession_number: Optional[str] = Field(default=None, max_length=100)
    original_location: Optional[str] = Field(default=None, max_length=255)
    research_notes: Optional[str] = _TEXT


class MediaUploadFields(_MediaFields):
    """The catalogue sent with each file of a batch, as a JSON form field."""

    tag_member_ids: list[str] = Field(default_factory=list, max_length=200)


class MediaUpdate(_MediaFields):
    #: Forced to substantial when the title, description or date changes.
    edit_kind: EditKind = "minor"
    edit_note: Optional[str] = Field(default=None, max_length=2000)


class MediaTagsReplace(BaseModel):
    member_ids: list[str] = Field(max_length=200)


class MediaPublishResult(BaseModel):
    item: MediaFullView
    #: Tagged people whose photo-use answer was not "granted" when it was
    #: published. Recorded with the publication; never a refusal.
    consent_warnings: list[MediaTagFull]


# --- Sources ---


class HistorySourceResponse(BaseModel):
    id: str
    name: str
    sort_order: int
    is_retired: bool
    usage_count: int = 0


class HistorySourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class HistorySourceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    is_retired: Optional[bool] = None


class HistorySourceMerge(BaseModel):
    into_source_id: str


# --- Albums ---


class AlbumSummary(BaseModel):
    id: str
    name: str
    description: Optional[str]
    level: AlbumLevel
    #: Only when the viewer may read the cover item.
    cover_media_id: Optional[str]
    #: Items the viewer may read.
    item_count: int


class AlbumEntry(BaseModel):
    """One entry of an album, photo or document, in the album's order."""

    kind: Literal["media", "document"]
    media: Optional[MediaSummary] = None
    document: Optional["DocumentSummary"] = None


class AlbumDetail(AlbumSummary):
    #: The album's photos the viewer may read (kept for phase 3 callers).
    items: list[MediaSummary]
    #: Photos and documents the viewer may read, in the album's one order.
    entries: list[AlbumEntry] = Field(default_factory=list)
    can_edit: bool


class AlbumCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = _TEXT
    level: AlbumLevel = AlbumLevel.DRAFT


class AlbumUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = _TEXT
    level: Optional[AlbumLevel] = None
    cover_media_id: Optional[str] = None


class AlbumEntryRef(BaseModel):
    kind: Literal["media", "document"]
    id: str = Field(min_length=1, max_length=36)


class AlbumItemsReplace(BaseModel):
    """Either the phase 3 list of photo ids (the album's documents stay), or
    an ordered list of photos and documents that replaces everything."""

    media_ids: Optional[list[str]] = Field(default=None, max_length=1000)
    entries: Optional[list[AlbumEntryRef]] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _one_list(self) -> "AlbumItemsReplace":
        if (self.media_ids is None) == (self.entries is None):
            raise ValueError("Send either media_ids or entries")
        return self


# --- Documents ---

#: A transcription of a long document: well past a description's limit, and
#: within MEDIUMTEXT.
_TRANSCRIPTION = Field(default=None, max_length=1_000_000)


class DocumentTagMember(BaseModel):
    member_id: str
    display_name: str


class _DocumentCatalogue(BaseModel):
    id: str
    kind: DocumentKind
    title: str
    description: Optional[str]
    taken_date: Optional[date]
    taken_date_precision: DatePrecision
    taken_date_circa: bool
    place: Optional[str]
    document_type_id: Optional[str]
    document_type_name: Optional[str]
    author: Optional[str]
    recipient: Optional[str]
    source_id: Optional[str]
    source_name: Optional[str]
    rights_note: Optional[str]
    accession_number: Optional[str]
    original_location: Optional[str]
    transcription: Optional[str]
    #: True when a PDF ran past the reading limits, so search covers part.
    text_truncated: bool
    page_count: Optional[int]
    width: Optional[int]
    height: Optional[int]
    has_thumbnail: bool
    #: The type of what ``/view`` returns: the stripped PDF, or a scan's WebP.
    mime_type: Optional[str]
    publication_level: PublicationLevel
    apparatus: list[ApparatusTag] = Field(default_factory=list)
    #: The events this document belongs to that the caller may read.
    events: list[EventSummary] = Field(default_factory=list)


class DocumentMemberView(_DocumentCatalogue):
    """What a member reading published history receives: no research notes,
    no original file, and tags only for people they may read."""

    view: Literal["member"] = "member"
    tags: list[DocumentTagMember]


class DocumentFullView(_DocumentCatalogue):
    view: Literal["full"] = "full"
    research_notes: Optional[str]
    original_filename: str
    original_mime_type: Optional[str]
    original_size_bytes: Optional[int]
    batch_id: Optional[str]
    tags: list[DocumentTagMember]
    published_at: Optional[datetime]
    revision_number: int
    public_revision_number: Optional[int]
    public_changes_pending: bool
    clearance_required: bool
    cleared_for_public: bool
    clearance: Optional[ClearanceRequestResponse]
    can_edit: bool
    can_publish: bool
    created_at: datetime
    updated_at: datetime


DocumentView = Union[DocumentFullView, DocumentMemberView]


class DocumentSummary(BaseModel):
    id: str
    kind: DocumentKind
    title: str
    taken_date: Optional[date]
    taken_date_precision: DatePrecision
    taken_date_circa: bool
    document_type_name: Optional[str]
    page_count: Optional[int]
    has_thumbnail: bool
    publication_level: PublicationLevel


class DocumentList(BaseModel):
    items: list[DocumentSummary]
    total: int


class _DocumentFields(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = _TEXT
    taken_date: Optional[date] = None
    taken_date_precision: Optional[DatePrecision] = None
    taken_date_circa: Optional[bool] = None
    place: Optional[str] = Field(default=None, max_length=255)
    document_type_id: Optional[str] = Field(default=None, max_length=36)
    author: Optional[str] = Field(default=None, max_length=255)
    recipient: Optional[str] = Field(default=None, max_length=255)
    source_id: Optional[str] = Field(default=None, max_length=36)
    rights_note: Optional[str] = _TEXT
    accession_number: Optional[str] = Field(default=None, max_length=100)
    original_location: Optional[str] = Field(default=None, max_length=255)
    research_notes: Optional[str] = _TEXT
    transcription: Optional[str] = _TRANSCRIPTION


class DocumentUploadFields(_DocumentFields):
    """The catalogue sent with each file of a batch, as a JSON form field."""

    tag_member_ids: list[str] = Field(default_factory=list, max_length=200)


class DocumentUpdate(_DocumentFields):
    #: Forced to substantial when the title, description, date, author,
    #: recipient or transcription changes.
    edit_kind: EditKind = "minor"
    edit_note: Optional[str] = Field(default=None, max_length=2000)


class DocumentTagsReplace(BaseModel):
    member_ids: list[str] = Field(max_length=200)


# --- Document types ---


class HistoryDocumentTypeResponse(BaseModel):
    id: str
    name: str
    sort_order: int
    is_retired: bool
    usage_count: int = 0


class HistoryDocumentTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class HistoryDocumentTypeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    is_retired: Optional[bool] = None


class HistoryDocumentTypeMerge(BaseModel):
    into_type_id: str


# --- Phase 5: managed lists (stations, apparatus types, event types) ---


class HistoryListEntryResponse(BaseModel):
    id: str
    name: str
    sort_order: int
    is_retired: bool
    usage_count: int = 0


class HistoryListEntryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)


class HistoryListEntryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    is_retired: Optional[bool] = None


class HistoryListEntryMerge(BaseModel):
    into_id: str = Field(max_length=36)


# --- Phase 5: historical apparatus ---


class _PartialSpanWrite(BaseModel):
    start_date: Optional[date] = None
    start_precision: DatePrecision = DatePrecision.YEAR
    start_circa: bool = False
    end_date: Optional[date] = None
    end_precision: DatePrecision = DatePrecision.YEAR
    end_circa: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> "_PartialSpanWrite":
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("A period cannot end before it starts")
        return self


class DesignationWrite(_PartialSpanWrite):
    designation: str = Field(min_length=1, max_length=100)
    station_id: Optional[str] = Field(default=None, max_length=36)


class DesignationResponse(BaseModel):
    id: str
    designation: str
    station_id: Optional[str]
    station_name: Optional[str]
    start_date: Optional[date]
    start_precision: DatePrecision
    start_circa: bool
    end_date: Optional[date]
    end_precision: DatePrecision
    end_circa: bool


class _ApparatusCatalogue(BaseModel):
    id: str
    name: str
    apparatus_type_id: Optional[str]
    apparatus_type_name: Optional[str]
    year: Optional[int]
    make: Optional[str]
    model: Optional[str]
    body_builder: Optional[str]
    pump_gpm: Optional[int]
    tank_gallons: Optional[int]
    ladder_feet: Optional[int]
    in_service_date: Optional[date]
    in_service_precision: DatePrecision
    in_service_circa: bool
    out_of_service_date: Optional[date]
    out_of_service_precision: DatePrecision
    out_of_service_circa: bool
    disposition: ApparatusDisposition
    current_location: Optional[str]
    description: Optional[str]
    source_id: Optional[str]
    source_name: Optional[str]
    accession_number: Optional[str]
    designations: list[DesignationResponse]
    #: "1924–1968", "1998–present", or none when no dates are known.
    service_span: Optional[str]
    publication_level: PublicationLevel


class ApparatusMemberView(_ApparatusCatalogue):
    """What a member reading published history receives: no research notes
    and no link to the fleet record."""

    view: Literal["member"] = "member"


class ApparatusFullView(_ApparatusCatalogue):
    view: Literal["full"] = "full"
    research_notes: Optional[str]
    fleet_apparatus_id: Optional[str]
    #: The fleet truck's name, when the record was made from one that still
    #: exists.
    fleet_label: Optional[str]
    published_at: Optional[datetime]
    revision_number: int
    public_revision_number: Optional[int]
    public_changes_pending: bool
    clearance_required: bool
    cleared_for_public: bool
    clearance: Optional[ClearanceRequestResponse]
    can_edit: bool
    can_publish: bool
    created_at: datetime
    updated_at: datetime


ApparatusView = Union[ApparatusFullView, ApparatusMemberView]


class ApparatusSummary(BaseModel):
    id: str
    name: str
    apparatus_type_name: Optional[str]
    year: Optional[int]
    make: Optional[str]
    model: Optional[str]
    #: Unit numbers, oldest first.
    designations: list[str]
    service_span: Optional[str]
    disposition: ApparatusDisposition
    publication_level: PublicationLevel


class ApparatusList(BaseModel):
    items: list[ApparatusSummary]
    total: int


class _ApparatusFields(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    apparatus_type_id: Optional[str] = Field(default=None, max_length=36)
    year: Optional[int] = Field(default=None, ge=1600, le=2200)
    make: Optional[str] = Field(default=None, max_length=100)
    model: Optional[str] = Field(default=None, max_length=100)
    body_builder: Optional[str] = Field(default=None, max_length=100)
    pump_gpm: Optional[int] = Field(default=None, ge=0, le=100000)
    tank_gallons: Optional[int] = Field(default=None, ge=0, le=100000)
    ladder_feet: Optional[int] = Field(default=None, ge=0, le=1000)
    in_service_date: Optional[date] = None
    in_service_precision: Optional[DatePrecision] = None
    in_service_circa: Optional[bool] = None
    out_of_service_date: Optional[date] = None
    out_of_service_precision: Optional[DatePrecision] = None
    out_of_service_circa: Optional[bool] = None
    disposition: Optional[ApparatusDisposition] = None
    current_location: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = _TEXT
    research_notes: Optional[str] = _TEXT
    source_id: Optional[str] = Field(default=None, max_length=36)
    accession_number: Optional[str] = Field(default=None, max_length=100)


class ApparatusCreate(_ApparatusFields):
    name: str = Field(min_length=1, max_length=200)
    designations: list[DesignationWrite] = Field(default_factory=list, max_length=50)


class ApparatusUpdate(_ApparatusFields):
    #: Replaces every designation when sent; left alone when omitted.
    designations: Optional[list[DesignationWrite]] = Field(default=None, max_length=50)
    #: Forced to substantial when anything a reader sees changes.
    edit_kind: EditKind = "minor"
    edit_note: Optional[str] = Field(default=None, max_length=2000)


class FleetOption(BaseModel):
    """An Apparatus-module truck a History record can be started from."""

    id: str
    unit_number: str
    name: Optional[str]
    description: str
    is_archived: bool
    #: The History record already made from this truck, if any.
    history_apparatus_id: Optional[str]


class FleetApparatusCreate(BaseModel):
    fleet_apparatus_id: str = Field(max_length=36)


# --- Phase 5: events ---


class EventMemberLink(BaseModel):
    member_id: str
    display_name: str
    role: Optional[str]


class EventMemberWrite(BaseModel):
    member_id: str = Field(max_length=36)
    role: Optional[str] = Field(default=None, max_length=100)


class _EventCatalogue(EventSummary):
    description: Optional[str]
    station_id: Optional[str]
    event_type_id: Optional[str]
    source_id: Optional[str]
    source_name: Optional[str]
    #: Each link only where the caller may read the record it points at.
    members: list[EventMemberLink]
    apparatus: list[ApparatusTag]
    media: list[MediaSummary]
    documents: list[DocumentSummary]


class EventMemberView(_EventCatalogue):
    view: Literal["member"] = "member"


class EventFullView(_EventCatalogue):
    view: Literal["full"] = "full"
    research_notes: Optional[str]
    published_at: Optional[datetime]
    revision_number: int
    public_revision_number: Optional[int]
    public_changes_pending: bool
    clearance_required: bool
    cleared_for_public: bool
    clearance: Optional[ClearanceRequestResponse]
    can_edit: bool
    can_publish: bool
    created_at: datetime
    updated_at: datetime


EventView = Union[EventFullView, EventMemberView]


class EventList(BaseModel):
    items: list[EventSummary]
    total: int


class _EventLinks(BaseModel):
    """The links an event write may set. A list that is sent replaces that
    set; one that is omitted is left alone."""

    members: Optional[list[EventMemberWrite]] = Field(default=None, max_length=500)
    apparatus_ids: Optional[list[str]] = Field(default=None, max_length=200)
    media_ids: Optional[list[str]] = Field(default=None, max_length=500)
    document_ids: Optional[list[str]] = Field(default=None, max_length=500)


class _EventFields(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = _TEXT
    start_date: Optional[date] = None
    start_precision: Optional[DatePrecision] = None
    start_circa: Optional[bool] = None
    end_date: Optional[date] = None
    end_precision: Optional[DatePrecision] = None
    end_circa: Optional[bool] = None
    place: Optional[str] = Field(default=None, max_length=255)
    station_id: Optional[str] = Field(default=None, max_length=36)
    event_type_id: Optional[str] = Field(default=None, max_length=36)
    research_notes: Optional[str] = _TEXT
    source_id: Optional[str] = Field(default=None, max_length=36)


class EventCreate(_EventFields, _EventLinks):
    title: str = Field(min_length=1, max_length=200)
    #: Required: an undated event cannot be placed on the timeline.
    start_date: date


class EventUpdate(_EventFields, _EventLinks):
    #: Forced to substantial when anything a reader sees changes, its links
    #: included.
    edit_kind: EditKind = "minor"
    edit_note: Optional[str] = Field(default=None, max_length=2000)


# --- Phase 5: the timeline ---

TimelineKind = Literal[
    "event",
    "apparatus_in",
    "apparatus_out",
    "line_of_duty",
    "title",
    "designation",
]


#: ``date`` under another name, for a model with a field called ``date``:
#: inside that class the field's name would shadow the type.
CalendarDate = date


class TimelineEntry(BaseModel):
    """One entry on a timeline: an event, or a milestone read from the record
    it links to. Nothing here is stored; correcting the record corrects it."""

    key: str
    kind: TimelineKind
    date: CalendarDate
    precision: DatePrecision
    circa: bool
    end_date: Optional[CalendarDate]
    end_precision: Optional[DatePrecision]
    end_circa: bool
    label: str
    detail: Optional[str]
    record_type: Literal["event", "apparatus", "member"]
    record_id: str
    event_type_id: Optional[str]
    event_type_name: Optional[str]
    #: For the archive's keepers, who see drafts on the timeline, badged.
    publication_level: PublicationLevel


class TimelineDecade(BaseModel):
    decade: int
    count: int


ClearanceReview.model_rebuild()
AlbumEntry.model_rebuild()
