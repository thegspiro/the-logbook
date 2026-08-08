/**
 * Skills Testing type definitions
 *
 * Types for the skills testing module, which allows training officers to
 * create skill evaluation templates and examiners to conduct field tests
 * on candidates using mobile devices.
 */

// ==================== Enums / Union Types ====================

export type SkillTestStatus =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  /** An official result withdrawn after the fact. Official results are never
   *  deleted, so a mistaken or invalidated test is voided instead: the record
   *  survives with its reason, stops counting toward statistics, and releases
   *  any training requirement it had credited. */
  | 'voided';

export type CriterionType = 'pass_fail' | 'score' | 'time_limit' | 'checklist' | 'statement';

export type TemplateStatus = 'draft' | 'published' | 'archived';

export type TemplateVisibility = 'all_members' | 'officers_only' | 'assigned_only';

export type TestResult = 'pass' | 'fail' | 'incomplete';

/** How much of a result the person tested may see. Officers always see all of it. */
export const ResultDisclosure = {
  /** Never shown to the candidate; the test does not appear in their history. */
  NONE: 'none',
  /** Marks and points, but no written commentary. */
  SCORES: 'scores',
  /** The full scorecard, examiner notes included. */
  FULL: 'full',
} as const;
export type ResultDisclosure = (typeof ResultDisclosure)[keyof typeof ResultDisclosure];

/** When a visible result becomes visible. */
export const ResultRelease = {
  /** As soon as the examiner submits. */
  ON_COMPLETION: 'on_completion',
  /** Only once an officer releases it. */
  ON_RELEASE: 'on_release',
} as const;
export type ResultRelease = (typeof ResultRelease)[keyof typeof ResultRelease];

/** One person granted sight of a single test's result. */
export interface SkillTestViewer {
  id: string;
  test_id: string;
  user_id: string;
  user_name?: string | undefined;
  granted_by?: string | undefined;
  granted_by_name?: string | undefined;
  granted_at?: string | undefined;
}

// ==================== Template Types ====================

/** A single evaluation criterion within a section */
export interface SkillCriterion {
  id: string;
  label: string;
  description?: string | undefined;
  type: CriterionType;
  required: boolean;
  sort_order: number;
  /** For 'score' type: minimum passing score */
  passing_score?: number | undefined;
  /** For 'score' type: maximum possible score */
  max_score?: number | undefined;
  /** For 'time_limit' type: max seconds allowed */
  time_limit_seconds?: number | undefined;
  /** For 'checklist' type: items that must be checked */
  checklist_items?: string[] | undefined;
  /** For 'statement' type: text the evaluator must read/state */
  statement_text?: string | undefined;
}

/** A section grouping related criteria within a template */
export interface SkillTemplateSection {
  id: string;
  name: string;
  description?: string | undefined;
  sort_order: number;
  criteria: SkillCriterion[];
}

/** A complete skill evaluation template */
export interface SkillTemplate {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  category?: string;
  version: number;
  status: TemplateStatus;
  visibility: TemplateVisibility;
  sections: SkillTemplateSection[];
  /** Global time limit for the entire test in seconds (optional) */
  time_limit_seconds?: number;
  /** Minimum overall passing percentage (0-100) */
  passing_percentage?: number;
  /** Whether all required criteria must pass regardless of overall score */
  require_all_critical: boolean;
  /** Training-pipeline requirement this template's tests satisfy (optional) */
  requirement_id?: string;
  /** Disclosure overrides for this template; null inherits the org default. */
  result_disclosure?: ResultDisclosure;
  result_release?: ResultRelease;
  result_viewer_positions?: string[];
  /** Tags for filtering/searching */
  tags?: string[];
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface SkillTemplateCreate {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  sections: SkillTemplateSectionCreate[];
  time_limit_seconds?: number | undefined;
  passing_percentage?: number | undefined;
  require_all_critical?: boolean | undefined;
  tags?: string[] | undefined;
  visibility?: TemplateVisibility | undefined;
  requirement_id?: string | undefined;
  /** null is meaningful here, not just absent: it says "inherit the department
   *  default" explicitly, which is how an existing override gets cleared. The
   *  backend's exclude_unset would drop an undefined and leave the old value. */
  result_disclosure?: ResultDisclosure | null | undefined;
  result_release?: ResultRelease | null | undefined;
  result_viewer_positions?: string[] | null | undefined;
}

export interface SkillTemplateSectionCreate {
  name: string;
  description?: string | undefined;
  sort_order: number;
  criteria: SkillCriterionCreate[];
}

export interface SkillCriterionCreate {
  label: string;
  description?: string | undefined;
  type: CriterionType;
  required: boolean;
  sort_order: number;
  passing_score?: number | undefined;
  max_score?: number | undefined;
  time_limit_seconds?: number | undefined;
  checklist_items?: string[] | undefined;
  statement_text?: string | undefined;
}

export interface SkillTemplateUpdate {
  name?: string | undefined;
  description?: string | undefined;
  category?: string | undefined;
  status?: TemplateStatus | undefined;
  visibility?: TemplateVisibility | undefined;
  sections?: SkillTemplateSectionCreate[] | undefined;
  time_limit_seconds?: number | null | undefined;
  passing_percentage?: number | null | undefined;
  require_all_critical?: boolean | undefined;
  tags?: string[] | undefined;
  requirement_id?: string | null | undefined;
  result_disclosure?: ResultDisclosure | null | undefined;
  result_release?: ResultRelease | null | undefined;
  result_viewer_positions?: string[] | null | undefined;
}

// ==================== Active Test Types ====================

/** Result for a single criterion during a test */
export interface CriterionResult {
  criterion_id: string;
  /** Sent to backend for name-based result matching */
  criterion_label?: string | undefined;
  passed: boolean | null;
  score?: number | undefined;
  time_seconds?: number | undefined;
  checklist_completed?: boolean[] | undefined;
  notes?: string | undefined;
}

/** Results for a section during a test */
export interface SectionResult {
  section_id: string;
  /** Sent to backend for name-based result matching */
  section_name?: string | undefined;
  criteria_results: CriterionResult[];
}

/** A complete skill test instance */
export interface SkillTest {
  id: string;
  organization_id: string;
  template_id: string;
  template_name: string;
  candidate_id: string;
  candidate_name: string;
  examiner_id: string;
  examiner_name: string;
  /** Training-pipeline requirement this test satisfies (inherited/overridable) */
  requirement_id?: string;
  status: SkillTestStatus;
  result: TestResult;
  is_practice: boolean;
  /** Optimistic-concurrency counter; send back as expected_version on write. */
  version: number;
  section_results: SectionResult[];
  /** Overall score as a percentage (0-100) */
  overall_score?: number | undefined;
  /** Total elapsed time in seconds */
  elapsed_seconds?: number | undefined;
  notes?: string | undefined;
  started_at?: string | undefined;
  completed_at?: string | undefined;
  created_at: string;
  updated_at: string;
  /** Disclosure overrides set on this test; null inherits the template's. */
  result_disclosure?: ResultDisclosure | undefined;
  result_release?: ResultRelease | undefined;
  result_viewer_positions?: string[] | undefined;
  /** Release trail — set once an officer releases the result. */
  released_at?: string | undefined;
  released_by?: string | undefined;
  /** Void trail — present only when an official result has been withdrawn */
  voided_at?: string | undefined;
  voided_by?: string | undefined;
  voided_by_name?: string | undefined;
  void_reason?: string | undefined;
  /** Validation trail — an official result counts only once a training officer
   *  signs it off. Unset while a member-run test awaits review. */
  validated_at?: string | undefined;
  validated_by?: string | undefined;
  validated_by_name?: string | undefined;
  /** Backend-derived: a completed official test with no sign-off yet. */
  pending_validation?: boolean | undefined;
  /** Template sections for active test rendering (from API response) */
  template_sections?: SkillTemplateSection[] | undefined;
  /** Template global time limit in seconds */
  template_time_limit_seconds?: number | undefined;
}

export interface SkillTestCreate {
  template_id: string;
  candidate_id: string;
  notes?: string | undefined;
  is_practice?: boolean | undefined;
  /** Override the requirement this test satisfies; defaults to the template's */
  requirement_id?: string | undefined;
}

export interface SkillTestUpdate {
  status?: SkillTestStatus;
  section_results?: SectionResult[];
  overall_score?: number;
  elapsed_seconds?: number;
  notes?: string;
  result?: TestResult;
  requirement_id?: string | null;
  /** The version last seen. A stale value is refused with 409 rather than
   *  silently overwriting whoever wrote in between. */
  expected_version?: number;
}

// ==================== Summary / List Types ====================

export interface SkillTemplateListItem {
  id: string;
  name: string;
  description?: string;
  category?: string;
  status: TemplateStatus;
  visibility: TemplateVisibility;
  version: number;
  section_count: number;
  criteria_count: number;
  requirement_id?: string;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface SkillTestListItem {
  id: string;
  template_id: string;
  template_name: string;
  candidate_id: string;
  candidate_name: string;
  examiner_id: string;
  examiner_name: string;
  status: SkillTestStatus;
  result: TestResult;
  is_practice: boolean;
  /** Widened to include undefined for the same reason as `voided_at` below —
   *  validating a test patches this row from a SkillTest response, where the
   *  score is optional, and exactOptionalPropertyTypes rejects a bare `?:`. */
  overall_score?: number | undefined;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  /** Set once an officer has released the result to the candidate. */
  released_at?: string | undefined;
  /** Explicitly widened to include undefined: with exactOptionalPropertyTypes,
   *  the store patches this field straight from a SkillTest response where it
   *  is optional, and assigning undefined to a bare `?:` property is an error. */
  voided_at?: string | undefined;
  /** Set once a training officer has accepted the result against the
   *  candidate's record. Null while a member-run test awaits review. */
  validated_at?: string | undefined;
  pending_validation?: boolean | undefined;
}

/** A selectable candidate for the start-test picker. Id and display name only —
 *  the endpoint behind it is open to every member, so it carries no contact
 *  information. */
export interface SkillTestCandidate {
  id: string;
  name: string;
}

export interface SkillTestingSummary {
  total_templates: number;
  published_templates: number;
  total_tests: number;
  tests_this_month: number;
  pass_rate: number | null;
  average_score: number | null;
  /** Member-run results awaiting an officer's sign-off. 0 for readers who
   *  cannot validate — it is an org-wide count of other people's evaluations. */
  pending_validation?: number | undefined;
}
