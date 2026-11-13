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

export interface TitleRef {
  id: string;
  name: string;
}

export interface HistoryTitle {
  id: string;
  name: string;
  source: 'rank' | 'position' | 'custom';
  sort_order: number;
  is_retired: boolean;
  usage_count: number;
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
  record_type: 'member' | 'media';
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

export interface ClearanceReview {
  request: ClearanceRequest;
  /** A person or a photo/media item, as members would read it: which one is
   * `request.record_type`. */
  record: HistoricalMemberMemberView | MediaMemberView;
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
  has_thumbnail: boolean;
  mime_type: string | null;
  publication_level: PublicationLevel;
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

export interface AlbumDetail extends AlbumSummary {
  items: MediaSummary[];
  can_edit: boolean;
}

export interface MediaQuery {
  search?: string | undefined;
  kind?: MediaKind | undefined;
  decade?: number | undefined;
  album_id?: string | undefined;
  member_id?: string | undefined;
  level?: PublicationLevel | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}
