/**
 * History Module Types
 *
 * snake_case, matching `backend/app/schemas/history.py` (no alias generator).
 */

export const PublicationLevel = {
  DRAFT: 'draft',
  MEMBERS: 'members',
  PUBLIC: 'public',
} as const;
export type PublicationLevel = (typeof PublicationLevel)[keyof typeof PublicationLevel];

export const PUBLICATION_LEVEL_LABELS: Record<PublicationLevel, string> = {
  draft: 'Draft',
  members: 'Published to members',
  public: 'Public',
};

export const FieldVisibility = {
  HISTORIAN: 'historian',
  MEMBERS: 'members',
  PUBLIC: 'public',
} as const;
export type FieldVisibility = (typeof FieldVisibility)[keyof typeof FieldVisibility];

export const FIELD_VISIBILITY_LABELS: Record<FieldVisibility, string> = {
  historian: 'Historian only',
  members: 'Members',
  public: 'Public',
};

export const DatePrecision = {
  DAY: 'day',
  MONTH: 'month',
  YEAR: 'year',
} as const;
export type DatePrecision = (typeof DatePrecision)[keyof typeof DatePrecision];

export const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
  day: 'Exact day',
  month: 'Month and year',
  year: 'Year only',
};

export const RelationType = {
  PARENT_OF: 'parent_of',
  GRANDPARENT_OF: 'grandparent_of',
  SIBLING: 'sibling',
  SPOUSE: 'spouse',
  OTHER: 'other',
} as const;
export type RelationType = (typeof RelationType)[keyof typeof RelationType];

/** Read from the person being edited: "is the ___ of" the other person. */
export const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  parent_of: 'Parent of',
  grandparent_of: 'Grandparent of',
  sibling: 'Sibling of',
  spouse: 'Spouse of',
  other: 'Other relationship…',
};

export const ClearanceStatus = {
  PENDING: 'pending',
  CLEARED: 'cleared',
  RETURNED: 'returned',
  WITHDRAWN: 'withdrawn',
} as const;
export type ClearanceStatus = (typeof ClearanceStatus)[keyof typeof ClearanceStatus];

export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  pending: 'Awaiting clearance',
  cleared: 'Cleared',
  returned: 'Returned for changes',
  withdrawn: 'Withdrawn',
};

export type ClearancePurpose = 'public' | 'review';
export type ClearanceRecordType = 'member' | 'media' | 'document' | 'apparatus' | 'event' | 'article';
export type ClearanceDecisionKind = 'cleared' | 'returned';
export type EditKind = 'minor' | 'substantial';

export type RevisionKind =
  | 'created'
  | 'minor'
  | 'substantial'
  | 'published'
  | 'unpublished'
  | 'submitted'
  | 'cleared'
  | 'returned'
  | 'withdrawn';

export const REVISION_KIND_LABELS: Record<RevisionKind, string> = {
  created: 'Created',
  minor: 'Minor edit',
  substantial: 'Substantial edit',
  published: 'Published',
  unpublished: 'Unpublished',
  submitted: 'Submitted for clearance',
  cleared: 'Cleared',
  returned: 'Returned for changes',
  withdrawn: 'Clearance withdrawn',
};

/** A title held in a service period, with the dates it was held when known. */
export interface TitleRef {
  id: string;
  name: string;
  held_from_date?: string | null;
  held_from_precision?: DatePrecision;
  held_from_circa?: boolean;
  held_to_date?: string | null;
  held_to_precision?: DatePrecision;
  held_to_circa?: boolean;
}

export interface HistoryTitle {
  id: string;
  name: string;
  source: 'rank' | 'position' | 'custom';
  sort_order: number;
  is_retired: boolean;
  /** Whether a dated start of this title reaches the department timeline.
   * Off unless the Historian turns it on. */
  show_on_timeline?: boolean;
  usage_count: number;
}

/** A held title as a service period saves it. */
export interface HeldTitleWrite {
  title_id: string;
  held_from_date: string | null;
  held_from_precision: DatePrecision;
  held_from_circa: boolean;
  held_to_date: string | null;
  held_to_precision: DatePrecision;
  held_to_circa: boolean;
}

export interface ServicePeriod {
  id: string;
  start_date: string | null;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
  is_ongoing: boolean;
  notes: string | null;
  titles: TitleRef[];
}

export interface ServicePeriodWrite {
  start_date: string | null;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
  is_ongoing: boolean;
  notes: string | null;
  title_ids: string[];
  /** The titles with their dates; when sent, used instead of `title_ids`. */
  titles?: HeldTitleWrite[] | undefined;
}

export interface Relation {
  id: string;
  other_member_id: string;
  other_display_name: string;
  relationship: string;
}

export interface HistoricalMemberSummary {
  id: string;
  display_name: string;
  last_name: string;
  first_name: string | null;
  nickname: string | null;
  service_years: string | null;
  titles: string[];
  is_memorial: boolean;
  is_line_of_duty_death: boolean;
  publication_level: PublicationLevel;
}

export interface HistoricalMemberList {
  items: HistoricalMemberSummary[];
  total: number;
}

interface PersonViewBase {
  id: string;
  display_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  nickname: string | null;
  badge_number: string | null;
  biography_html: string | null;
  is_memorial: boolean;
  is_line_of_duty_death: boolean;
  service_periods: ServicePeriod[];
  relations: Relation[];
  publication_level: PublicationLevel;
  /** The merged-away id the request named, when the server forwarded it here. */
  redirected_from?: string | null;
}

/** A member reading what is published: no restricted fields exist here. */
export interface HistoricalMemberMemberView extends PersonViewBase {
  view: 'member';
  death_date?: string | null;
  death_date_precision?: DatePrecision | null;
  death_date_circa?: boolean | null;
  death_circumstances?: string | null;
  burial_location?: string | null;
}

export interface ClearanceStepState {
  index: number;
  name: string;
  position_id: string | null;
  position_name: string | null;
  blocked: boolean;
  decision: ClearanceDecisionKind | null;
  decided_by_name: string | null;
  decided_by_author: boolean;
  note: string | null;
  decided_at: string | null;
}

export interface ClearanceRequest {
  id: string;
  record_type: ClearanceRecordType;
  record_id: string;
  record_label: string;
  revision_number: number;
  purpose: ClearancePurpose;
  status: ClearanceStatus;
  current_step_index: number;
  steps: ClearanceStepState[];
  submitted_by_name: string | null;
  submitted_at: string;
  closed_at: string | null;
  can_decide: boolean;
}

export interface HistoricalMemberFullView extends PersonViewBase {
  view: 'full';
  user_id: string | null;
  linked_member_name: string | null;
  birth_date: string | null;
  birth_date_precision: DatePrecision;
  birth_date_circa: boolean;
  biography: string | null;
  addresses: string | null;
  verification_sources: string | null;
  research_notes: string | null;
  death_date: string | null;
  death_date_precision: DatePrecision;
  death_date_circa: boolean;
  death_date_visibility: FieldVisibility;
  death_circumstances: string | null;
  death_circumstances_visibility: FieldVisibility;
  burial_location: string | null;
  burial_location_visibility: FieldVisibility;
  published_at: string | null;
  revision_number: number;
  public_revision_number: number | null;
  public_changes_pending: boolean;
  clearance_required: boolean;
  cleared_for_public: boolean;
  clearance: ClearanceRequest | null;
  can_edit: boolean;
  can_publish: boolean;
  created_at: string;
  updated_at: string;
  /** Set when the record was created by an import. */
  import_id?: string | null;
}

export type HistoricalMemberView = HistoricalMemberFullView | HistoricalMemberMemberView;

/** Every editable field of a person. Update payloads send `null` to clear. */
export interface PersonFields {
  first_name?: string | null | undefined;
  middle_name?: string | null | undefined;
  last_name?: string | undefined;
  suffix?: string | null | undefined;
  nickname?: string | null | undefined;
  badge_number?: string | null | undefined;
  user_id?: string | null | undefined;
  birth_date?: string | null | undefined;
  birth_date_precision?: DatePrecision | undefined;
  birth_date_circa?: boolean | undefined;
  biography?: string | null | undefined;
  addresses?: string | null | undefined;
  verification_sources?: string | null | undefined;
  research_notes?: string | null | undefined;
  is_memorial?: boolean | undefined;
  is_line_of_duty_death?: boolean | undefined;
  death_date?: string | null | undefined;
  death_date_precision?: DatePrecision | undefined;
  death_date_circa?: boolean | undefined;
  death_date_visibility?: FieldVisibility | undefined;
  death_circumstances?: string | null | undefined;
  death_circumstances_visibility?: FieldVisibility | undefined;
  burial_location?: string | null | undefined;
  burial_location_visibility?: FieldVisibility | undefined;
}

export interface PersonCreate extends PersonFields {
  last_name: string;
}

export interface PersonUpdate extends PersonFields {
  edit_kind: EditKind;
  edit_note?: string | undefined;
}

export interface PersonWarning {
  kind: 'badge_number' | 'possible_duplicate';
  message: string;
  member_id: string;
  display_name: string;
  service_years: string | null;
}

export interface Revision {
  id: string;
  revision_number: number;
  kind: RevisionKind;
  note: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface HonorRollEntry {
  id: string;
  display_name: string;
  titles: string[];
  service_years: string | null;
  death_date: string | null;
  death_date_precision: DatePrecision | null;
  death_date_circa: boolean | null;
  death_circumstances: string | null;
}

export interface ClearanceStep {
  id: string;
  step_order: number;
  name: string;
  position_id: string | null;
  position_name: string | null;
  blocked: boolean;
}

export type ClearanceReviewRecord =
  | HistoricalMemberMemberView
  | MediaMemberView
  | DocumentMemberView
  | ApparatusMemberView
  | EventMemberView
  | ArticleMemberView;

export interface ClearanceReview {
  request: ClearanceRequest;
  /** A person, photo, document, apparatus, event or article, as members
   * would read it: which one is `request.record_type`. */
  record: ClearanceReviewRecord;
}

export interface PeopleQuery {
  search?: string | undefined;
  decade?: number | undefined;
  title_id?: string | undefined;
  memorial?: boolean | undefined;
  line_of_duty?: boolean | undefined;
  level?: PublicationLevel | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// --- Import ---

export const ImportStatus = {
  DRAFT: 'draft',
  COMMITTED: 'committed',
  DISCARDED: 'discarded',
  EXPIRED: 'expired',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export const ImportDecision = {
  MATCH: 'match',
  MAP: 'map',
  CREATE: 'create',
  SKIP: 'skip',
  SAME_AS: 'same_as',
} as const;
export type ImportDecision = (typeof ImportDecision)[keyof typeof ImportDecision];

export const IMPORT_DECISION_LABELS: Record<ImportDecision, string> = {
  match: 'Add to an existing record',
  map: 'New record linked to a member account',
  create: 'New record',
  skip: 'Skip this row',
  same_as: 'Same person as another line',
};

export type TitleAction = 'map' | 'create' | 'drop';

/** Every column the import reads, in template order, with its label. */
export const IMPORT_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  middle_name: 'Middle name',
  last_name: 'Last name',
  suffix: 'Suffix',
  nickname: 'Nickname',
  badge_number: 'Badge number',
  joined: 'Joined',
  left: 'Left',
  titles: 'Titles',
  birth_date: 'Birth date',
  death_date: 'Death date',
  line_of_duty_death: 'Line of duty death',
  notes: 'Notes',
};

export interface ImportSummary {
  id: string;
  status: ImportStatus;
  source_filename: string;
  row_count: number;
  column_mapping: Record<string, string>;
  summary: Record<string, number> | null;
  expires_at: string | null;
  created_at: string;
  committed_at: string | null;
}

export interface ImportSuggestion {
  kind: 'match' | 'map' | 'same_as';
  id: string;
  strength: 'strong' | 'weak';
  label: string;
}

export interface ImportRow {
  id: string;
  line_number: number;
  values: Record<string, string>;
  edited_fields: string[];
  problems: string[];
  decision: ImportDecision | null;
  target_member_id: string | null;
  target_user_id: string | null;
  target_row_id: string | null;
  target_label: string | null;
  suggestions: ImportSuggestion[];
}

export interface ImportTitle {
  text: string;
  key: string;
  status: 'known' | 'mapped' | 'create' | 'dropped' | 'unresolved';
  title_id?: string | null;
}

export interface ImportDetail extends ImportSummary {
  rows: ImportRow[];
  titles: ImportTitle[];
  ready: boolean;
  blockers: string[];
}

export interface ImportRowUpdate {
  edits?: Record<string, string> | undefined;
  decision?: ImportDecision | null | undefined;
  target_member_id?: string | undefined;
  target_user_id?: string | undefined;
  target_row_id?: string | undefined;
}

export interface ImportTitleChoice {
  text: string;
  action: TitleAction;
  title_id?: string | undefined;
}

export interface RemoveRecordsResult {
  removed: number;
  kept: { id: string; display_name: string; reason: string }[];
}

// --- Merge ---

export type MergeChoice = 'keep' | 'other' | 'both';

export interface MergeSide {
  id: string;
  display_name: string;
  service_years: string | null;
  publication_level: PublicationLevel;
  period_count: number;
  relation_count: number;
  linked_member_name: string | null;
  is_memorial: boolean;
  is_line_of_duty_death: boolean;
}

export interface MergeField {
  field: string;
  label: string;
  keep_value: string | null;
  other_value: string | null;
  state: 'same' | 'keep_blank' | 'other_blank' | 'differs';
  can_keep_both: boolean;
}

export interface MergePreview {
  keep: MergeSide;
  other: MergeSide;
  fields: MergeField[];
  refusal: string | null;
  warnings: string[];
}

// --- Photos and media ---

export const MediaKind = {
  PHOTO: 'photo',
  AUDIO: 'audio',
  VIDEO: 'video',
} as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  photo: 'Photo',
  audio: 'Audio',
  video: 'Video',
};

export type ConsentState = 'granted' | 'declined' | 'not_answered' | 'no_account';

/** What each photo-use answer means for the Historian. Never a refusal. */
export const CONSENT_STATE_LABELS: Record<ConsentState, string> = {
  granted: 'Photo use granted',
  declined: 'Declined photo use',
  not_answered: 'Never answered the photo-use question',
  no_account: 'No member account to ask',
};

export interface MediaSummary {
  id: string;
  kind: MediaKind;
  title: string;
  taken_date: string | null;
  taken_date_precision: DatePrecision;
  taken_date_circa: boolean;
  duration_seconds: number | null;
  has_thumbnail: boolean;
  publication_level: PublicationLevel;
}

export interface MediaList {
  items: MediaSummary[];
  total: number;
}

export interface MediaTag {
  member_id: string;
  display_name: string;
}

export interface MediaTagFull extends MediaTag {
  consent: ConsentState;
}

interface MediaCatalogue {
  id: string;
  kind: MediaKind;
  title: string;
  description: string | null;
  taken_date: string | null;
  taken_date_precision: DatePrecision;
  taken_date_circa: boolean;
  place: string | null;
  creator: string | null;
  source_id: string | null;
  source_name: string | null;
  rights_note: string | null;
  accession_number: string | null;
  original_location: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  has_thumbnail: boolean;
  mime_type: string | null;
  publication_level: PublicationLevel;
  /** Apparatus the item shows, as far as the caller may read them. */
  apparatus: ApparatusTag[];
  /** The events the item belongs to that the caller may read. */
  events: EventSummary[];
}

export interface MediaMemberView extends MediaCatalogue {
  view: 'member';
  tags: MediaTag[];
}

export interface MediaFullView extends MediaCatalogue {
  view: 'full';
  research_notes: string | null;
  original_filename: string;
  original_mime_type: string | null;
  original_size_bytes: number | null;
  original_sha256: string | null;
  batch_id: string | null;
  tags: MediaTagFull[];
  published_at: string | null;
  revision_number: number;
  public_revision_number: number | null;
  public_changes_pending: boolean;
  clearance_required: boolean;
  cleared_for_public: boolean;
  clearance: ClearanceRequest | null;
  can_edit: boolean;
  can_publish: boolean;
  created_at: string;
  updated_at: string;
}

export type MediaView = MediaFullView | MediaMemberView;

/** The catalogue fields a keeper sets. Update payloads send `null` to clear. */
export interface MediaFields {
  title?: string | undefined;
  description?: string | null | undefined;
  taken_date?: string | null | undefined;
  taken_date_precision?: DatePrecision | undefined;
  taken_date_circa?: boolean | undefined;
  place?: string | null | undefined;
  creator?: string | null | undefined;
  source_id?: string | null | undefined;
  rights_note?: string | null | undefined;
  accession_number?: string | null | undefined;
  original_location?: string | null | undefined;
  research_notes?: string | null | undefined;
}

export interface MediaUploadFields extends MediaFields {
  tag_member_ids?: string[] | undefined;
}

export interface MediaUpdate extends MediaFields {
  edit_kind?: EditKind | undefined;
  edit_note?: string | undefined;
}

export interface MediaPublishResult {
  item: MediaFullView;
  consent_warnings: MediaTagFull[];
}

export interface HistorySource {
  id: string;
  name: string;
  sort_order: number;
  is_retired: boolean;
  usage_count: number;
}

export type AlbumLevel = 'draft' | 'members';

export interface AlbumSummary {
  id: string;
  name: string;
  description: string | null;
  level: AlbumLevel;
  cover_media_id: string | null;
  item_count: number;
}

export interface AlbumEntry {
  kind: 'media' | 'document';
  media: MediaSummary | null;
  document: DocumentSummary | null;
}

export interface AlbumDetail extends AlbumSummary {
  /** The album's photos (kept for the phase 3 screens). */
  items: MediaSummary[];
  /** Photos and documents, in the album's one order. */
  entries: AlbumEntry[];
  can_edit: boolean;
}

export interface AlbumEntryRef {
  kind: 'media' | 'document';
  id: string;
}

export interface MediaQuery {
  search?: string | undefined;
  kind?: MediaKind | undefined;
  decade?: number | undefined;
  album_id?: string | undefined;
  member_id?: string | undefined;
  apparatus_id?: string | undefined;
  level?: PublicationLevel | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// --- Documents ---

export const DocumentKind = {
  PDF: 'pdf',
  IMAGE: 'image',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  title: string;
  taken_date: string | null;
  taken_date_precision: DatePrecision;
  taken_date_circa: boolean;
  document_type_name: string | null;
  page_count: number | null;
  has_thumbnail: boolean;
  publication_level: PublicationLevel;
}

export interface DocumentList {
  items: DocumentSummary[];
  total: number;
}

interface DocumentCatalogue {
  id: string;
  kind: DocumentKind;
  title: string;
  description: string | null;
  taken_date: string | null;
  taken_date_precision: DatePrecision;
  taken_date_circa: boolean;
  place: string | null;
  document_type_id: string | null;
  document_type_name: string | null;
  author: string | null;
  recipient: string | null;
  source_id: string | null;
  source_name: string | null;
  rights_note: string | null;
  accession_number: string | null;
  original_location: string | null;
  transcription: string | null;
  /** A long PDF was read only in part, so search covers part of it. */
  text_truncated: boolean;
  page_count: number | null;
  width: number | null;
  height: number | null;
  has_thumbnail: boolean;
  mime_type: string | null;
  publication_level: PublicationLevel;
  apparatus: ApparatusTag[];
  events: EventSummary[];
}

export interface DocumentMemberView extends DocumentCatalogue {
  view: 'member';
  tags: MediaTag[];
}

export interface DocumentFullView extends DocumentCatalogue {
  view: 'full';
  research_notes: string | null;
  original_filename: string;
  original_mime_type: string | null;
  original_size_bytes: number | null;
  batch_id: string | null;
  tags: MediaTag[];
  published_at: string | null;
  revision_number: number;
  public_revision_number: number | null;
  public_changes_pending: boolean;
  clearance_required: boolean;
  cleared_for_public: boolean;
  clearance: ClearanceRequest | null;
  can_edit: boolean;
  can_publish: boolean;
  created_at: string;
  updated_at: string;
}

export type DocumentView = DocumentFullView | DocumentMemberView;

/** The catalogue fields a keeper sets. Update payloads send `null` to clear. */
export interface DocumentFields extends Omit<MediaFields, 'creator'> {
  document_type_id?: string | null | undefined;
  author?: string | null | undefined;
  recipient?: string | null | undefined;
  transcription?: string | null | undefined;
}

export interface DocumentUploadFields extends DocumentFields {
  tag_member_ids?: string[] | undefined;
}

export interface DocumentUpdate extends DocumentFields {
  edit_kind?: EditKind | undefined;
  edit_note?: string | undefined;
}

/** A department's managed list entry: a source or a document type. */
export interface HistoryDocumentType {
  id: string;
  name: string;
  sort_order: number;
  is_retired: boolean;
  usage_count: number;
}

export interface DocumentQuery {
  search?: string | undefined;
  document_type_id?: string | undefined;
  decade?: number | undefined;
  album_id?: string | undefined;
  member_id?: string | undefined;
  apparatus_id?: string | undefined;
  level?: PublicationLevel | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/** Whether a clearance review's record is a document: its kind is a
 * document's, not a photo's. */
export const isDocumentRecord = (record: ClearanceReviewRecord): record is DocumentMemberView =>
  'kind' in record && (record.kind === 'pdf' || record.kind === 'image');

/** Whether a clearance review's record is an apparatus: only an apparatus
 * has designations. */
export const isApparatusRecord = (record: ClearanceReviewRecord): record is ApparatusMemberView =>
  'designations' in record;

/** Whether a clearance review's record is an event: only an event links
 * people with roles. */
export const isEventRecord = (record: ClearanceReviewRecord): record is EventMemberView =>
  'start_date' in record && 'members' in record;

/** Whether a clearance review's record is an article: only an article has
 * blocks. */
export const isArticleRecord = (record: ClearanceReviewRecord): record is ArticleMemberView => 'blocks' in record;

// --- Phase 5: managed lists (stations, apparatus types, event types) ---

/** One entry of a managed list. Sources and document types have this shape too. */
export interface HistoryListEntry {
  id: string;
  name: string;
  sort_order: number;
  is_retired: boolean;
  usage_count: number;
}

// --- Phase 5: historical apparatus ---

export const ApparatusDisposition = {
  IN_SERVICE: 'in_service',
  SOLD: 'sold',
  TRADED: 'traded',
  SCRAPPED: 'scrapped',
  PRESERVED: 'preserved',
  MUSEUM: 'museum',
  UNKNOWN: 'unknown',
} as const;
export type ApparatusDisposition = (typeof ApparatusDisposition)[keyof typeof ApparatusDisposition];

export const APPARATUS_DISPOSITION_LABELS: Record<ApparatusDisposition, string> = {
  in_service: 'Still in service',
  sold: 'Sold',
  traded: 'Traded',
  scrapped: 'Scrapped',
  preserved: 'Preserved',
  museum: 'In a museum',
  unknown: 'Not known',
};

export interface ApparatusTag {
  apparatus_id: string;
  name: string;
}

export interface Designation {
  id: string;
  designation: string;
  station_id: string | null;
  station_name: string | null;
  start_date: string | null;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
}

export interface DesignationWrite {
  designation: string;
  station_id: string | null;
  start_date: string | null;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
}

export interface ApparatusSummary {
  id: string;
  name: string;
  apparatus_type_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  designations: string[];
  service_span: string | null;
  disposition: ApparatusDisposition;
  publication_level: PublicationLevel;
}

export interface ApparatusList {
  items: ApparatusSummary[];
  total: number;
}

interface ApparatusCatalogue {
  id: string;
  name: string;
  apparatus_type_id: string | null;
  apparatus_type_name: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  body_builder: string | null;
  pump_gpm: number | null;
  tank_gallons: number | null;
  ladder_feet: number | null;
  in_service_date: string | null;
  in_service_precision: DatePrecision;
  in_service_circa: boolean;
  out_of_service_date: string | null;
  out_of_service_precision: DatePrecision;
  out_of_service_circa: boolean;
  disposition: ApparatusDisposition;
  current_location: string | null;
  description: string | null;
  source_id: string | null;
  source_name: string | null;
  accession_number: string | null;
  designations: Designation[];
  service_span: string | null;
  publication_level: PublicationLevel;
}

export interface ApparatusMemberView extends ApparatusCatalogue {
  view: 'member';
}

export interface ApparatusFullView extends ApparatusCatalogue {
  view: 'full';
  research_notes: string | null;
  fleet_apparatus_id: string | null;
  fleet_label: string | null;
  published_at: string | null;
  revision_number: number;
  public_revision_number: number | null;
  public_changes_pending: boolean;
  clearance_required: boolean;
  cleared_for_public: boolean;
  clearance: ClearanceRequest | null;
  can_edit: boolean;
  can_publish: boolean;
  created_at: string;
  updated_at: string;
}

export type ApparatusView = ApparatusFullView | ApparatusMemberView;

/** The catalogue fields a keeper sets. Update payloads send `null` to clear. */
export interface ApparatusFields {
  name?: string | undefined;
  apparatus_type_id?: string | null | undefined;
  year?: number | null | undefined;
  make?: string | null | undefined;
  model?: string | null | undefined;
  body_builder?: string | null | undefined;
  pump_gpm?: number | null | undefined;
  tank_gallons?: number | null | undefined;
  ladder_feet?: number | null | undefined;
  in_service_date?: string | null | undefined;
  in_service_precision?: DatePrecision | undefined;
  in_service_circa?: boolean | undefined;
  out_of_service_date?: string | null | undefined;
  out_of_service_precision?: DatePrecision | undefined;
  out_of_service_circa?: boolean | undefined;
  disposition?: ApparatusDisposition | undefined;
  current_location?: string | null | undefined;
  description?: string | null | undefined;
  research_notes?: string | null | undefined;
  source_id?: string | null | undefined;
  accession_number?: string | null | undefined;
}

export interface ApparatusCreate extends ApparatusFields {
  name: string;
  designations: DesignationWrite[];
}

export interface ApparatusUpdate extends ApparatusFields {
  designations?: DesignationWrite[] | undefined;
  edit_kind?: EditKind | undefined;
  edit_note?: string | undefined;
}

export interface FleetOption {
  id: string;
  unit_number: string;
  name: string | null;
  description: string;
  is_archived: boolean;
  history_apparatus_id: string | null;
}

export interface ApparatusQuery {
  search?: string | undefined;
  apparatus_type_id?: string | undefined;
  station_id?: string | undefined;
  decade?: number | undefined;
  level?: PublicationLevel | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// --- Phase 5: events ---

export interface EventSummary {
  id: string;
  title: string;
  start_date: string;
  start_precision: DatePrecision;
  start_circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision;
  end_circa: boolean;
  place: string | null;
  station_name: string | null;
  event_type_name: string | null;
  publication_level: PublicationLevel;
}

export interface EventList {
  items: EventSummary[];
  total: number;
}

export interface EventMemberLink {
  member_id: string;
  display_name: string;
  role: string | null;
}

export interface EventMemberWrite {
  member_id: string;
  role?: string | null | undefined;
}

interface EventCatalogue extends EventSummary {
  description: string | null;
  station_id: string | null;
  event_type_id: string | null;
  source_id: string | null;
  source_name: string | null;
  /** Each link only where the caller may read the record it points at. */
  members: EventMemberLink[];
  apparatus: ApparatusTag[];
  media: MediaSummary[];
  documents: DocumentSummary[];
}

export interface EventMemberView extends EventCatalogue {
  view: 'member';
}

export interface EventFullView extends EventCatalogue {
  view: 'full';
  research_notes: string | null;
  published_at: string | null;
  revision_number: number;
  public_revision_number: number | null;
  public_changes_pending: boolean;
  clearance_required: boolean;
  cleared_for_public: boolean;
  clearance: ClearanceRequest | null;
  can_edit: boolean;
  can_publish: boolean;
  created_at: string;
  updated_at: string;
}

export type EventView = EventFullView | EventMemberView;

/** An event's fields. Update payloads send `null` to clear. */
export interface EventFields {
  title?: string | undefined;
  description?: string | null | undefined;
  start_date?: string | undefined;
  start_precision?: DatePrecision | undefined;
  start_circa?: boolean | undefined;
  end_date?: string | null | undefined;
  end_precision?: DatePrecision | undefined;
  end_circa?: boolean | undefined;
  place?: string | null | undefined;
  station_id?: string | null | undefined;
  event_type_id?: string | null | undefined;
  research_notes?: string | null | undefined;
  source_id?: string | null | undefined;
}

/** The link sets an event write may replace. One that is omitted stays. */
export interface EventLinks {
  members?: EventMemberWrite[] | undefined;
  apparatus_ids?: string[] | undefined;
  media_ids?: string[] | undefined;
  document_ids?: string[] | undefined;
}

export interface EventCreate extends EventFields, EventLinks {
  title: string;
  start_date: string;
}

export interface EventUpdate extends EventFields, EventLinks {
  edit_kind?: EditKind | undefined;
  edit_note?: string | undefined;
}

export interface EventQuery {
  search?: string | undefined;
  event_type_id?: string | undefined;
  station_id?: string | undefined;
  decade?: number | undefined;
  member_id?: string | undefined;
  apparatus_id?: string | undefined;
  level?: PublicationLevel | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

// --- Phase 5: timelines ---

export const TimelineKind = {
  EVENT: 'event',
  APPARATUS_IN: 'apparatus_in',
  APPARATUS_OUT: 'apparatus_out',
  LINE_OF_DUTY: 'line_of_duty',
  TITLE: 'title',
  DESIGNATION: 'designation',
} as const;
export type TimelineKind = (typeof TimelineKind)[keyof typeof TimelineKind];

/** The milestone kinds the department timeline can show beside events. */
export const MILESTONE_KINDS: TimelineKind[] = ['apparatus_in', 'apparatus_out', 'line_of_duty', 'title'];

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  event: 'Event',
  apparatus_in: 'Apparatus into service',
  apparatus_out: 'Apparatus out of service',
  line_of_duty: 'Line-of-duty death',
  title: 'Title',
  designation: 'Unit number',
};

export interface TimelineEntry {
  key: string;
  kind: TimelineKind;
  date: string;
  precision: DatePrecision;
  circa: boolean;
  end_date: string | null;
  end_precision: DatePrecision | null;
  end_circa: boolean;
  label: string;
  detail: string | null;
  record_type: 'event' | 'apparatus' | 'member';
  record_id: string;
  event_type_id: string | null;
  event_type_name: string | null;
  publication_level: PublicationLevel;
}

export interface TimelineDecade {
  decade: number;
  count: number;
}

// --- Phase 6: articles ---

export const ArticleBlockKind = {
  TEXT: 'text',
  PHOTO: 'photo',
} as const;
export type ArticleBlockKind = (typeof ArticleBlockKind)[keyof typeof ArticleBlockKind];

export const ArticlePhotoSize = {
  FULL: 'full',
  HALF: 'half',
} as const;
export type ArticlePhotoSize = (typeof ArticlePhotoSize)[keyof typeof ArticlePhotoSize];

export interface ArticleSummary {
  id: string;
  title: string;
  subtitle: string | null;
  byline: string | null;
  summary: string | null;
  /** Only when the caller may see the cover photo. */
  cover: MediaSummary | null;
  publication_level: PublicationLevel;
  updated_at: string;
}

export interface ArticleList {
  items: ArticleSummary[];
  total: number;
}

export interface ArticleBlockView {
  id: string;
  kind: ArticleBlockKind;
  /** A text block's sanitized HTML. */
  html: string | null;
  /** A photo block's photo, when the caller may see it. In the editor's view
   * a photo since deleted or withdrawn is kept with `media` empty. */
  media: MediaSummary | null;
  media_id?: string | null | undefined;
  caption: string | null;
  size: ArticlePhotoSize;
}

export interface ArticleMemberLink {
  member_id: string;
  display_name: string;
}

/** An archive item an article draws on, for its Sources list. */
export interface ArticleSource {
  kind: 'document' | 'event' | 'photo';
  id: string;
  title: string;
}

interface ArticleCatalogue {
  id: string;
  title: string;
  subtitle: string | null;
  byline: string | null;
  summary: string | null;
  cover: MediaSummary | null;
  citations: string[];
  publication_level: PublicationLevel;
  updated_at: string;
  blocks: ArticleBlockView[];
  /** Each link only where the caller may read the record it points at. */
  members: ArticleMemberLink[];
  events: EventSummary[];
  apparatus: ApparatusTag[];
  documents: DocumentSummary[];
  sources: ArticleSource[];
}

export interface ArticleMemberView extends ArticleCatalogue {
  view: 'member';
}

export interface ArticleFullView extends ArticleCatalogue {
  view: 'full';
  cover_media_id: string | null;
  research_notes: string | null;
  published_at: string | null;
  revision_number: number;
  public_revision_number: number | null;
  public_changes_pending: boolean;
  /** Titles of the photos it shows that are not public; it cannot go for
   * public clearance until this is empty. */
  photos_not_public: string[];
  clearance_required: boolean;
  cleared_for_public: boolean;
  clearance: ClearanceRequest | null;
  can_edit: boolean;
  can_publish: boolean;
  created_at: string;
}

export type ArticleView = ArticleFullView | ArticleMemberView;

export interface ArticleBlockWrite {
  kind: ArticleBlockKind;
  html?: string | undefined;
  media_id?: string | undefined;
  caption?: string | null | undefined;
  size?: ArticlePhotoSize | undefined;
}

/** An article's fields. Update payloads send `null` to clear. */
export interface ArticleFields {
  title?: string | undefined;
  subtitle?: string | null | undefined;
  byline?: string | null | undefined;
  summary?: string | null | undefined;
  cover_media_id?: string | null | undefined;
  citations?: string[] | null | undefined;
  research_notes?: string | null | undefined;
}

/** The body and link sets an article write may replace. One omitted stays. */
export interface ArticleLinks {
  blocks?: ArticleBlockWrite[] | undefined;
  member_ids?: string[] | undefined;
  event_ids?: string[] | undefined;
  apparatus_ids?: string[] | undefined;
  document_ids?: string[] | undefined;
}

export interface ArticleCreate extends ArticleFields, ArticleLinks {
  title: string;
}

export interface ArticleUpdate extends ArticleFields, ArticleLinks {
  edit_kind?: EditKind | undefined;
  edit_note?: string | undefined;
}

export type ArticleSort = 'updated' | 'title';

export interface ArticleQuery {
  search?: string | undefined;
  member_id?: string | undefined;
  event_id?: string | undefined;
  apparatus_id?: string | undefined;
  document_id?: string | undefined;
  media_id?: string | undefined;
  level?: PublicationLevel | undefined;
  sort?: ArticleSort | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export type ArticleExportFormat = 'pdf' | 'docx';

// --- Public website (phase 7) ---

export type PublicWidgetTheme = 'auto' | 'light' | 'dark';

/** Each part of History the department's website may show. */
export interface HistoryPublicSwitches {
  people: boolean;
  honor_roll: boolean;
  photos: boolean;
  documents: boolean;
  events: boolean;
  apparatus: boolean;
  articles: boolean;
  timeline: boolean;
  today: boolean;
}

export interface HistoryPublicSettings extends HistoryPublicSwitches {
  widget_theme: PublicWidgetTheme;
  widget_show_branding: boolean;
  widget_link_exists: boolean;
  widget_token_created_at: string | null;
  portal_enabled: boolean;
  portal_has_key: boolean;
  /** The department's websites (Organization Settings → Forms), the only pages that may show the widget. */
  widget_websites: string[];
}

export type HistoryPublicSettingsUpdate = Partial<HistoryPublicSwitches> & {
  widget_theme?: PublicWidgetTheme | undefined;
  widget_show_branding?: boolean | undefined;
};

export interface HistoryWidgetEntry {
  key: string;
  kind: string;
  date: string;
  precision: DatePrecision;
  circa: boolean;
  label: string;
  detail: string | null;
  years_ago: number;
  anniversary: string;
}

/** What the "Today in history" widget shows. */
export interface HistoryWidgetToday {
  mode: 'today' | 'week' | 'none';
  date: string;
  entries: HistoryWidgetEntry[];
  theme: PublicWidgetTheme;
  organization_name: string | null;
  has_logo: boolean;
}
