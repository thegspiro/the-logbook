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
  | 'cancelled';

export type CriterionType =
  | 'pass_fail'
  | 'score'
  | 'time_limit'
  | 'checklist'
  | 'statement';

export type TemplateStatus =
  | 'draft'
  | 'published'
  | 'archived';

export type TemplateVisibility =
  | 'all_members'
  | 'officers_only'
  | 'assigned_only';

export type TestResult =
  | 'pass'
  | 'fail'
  | 'incomplete';

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
  status: SkillTestStatus;
  result: TestResult;
  is_practice: boolean;
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
}

export interface SkillTestUpdate {
  status?: SkillTestStatus;
  section_results?: SectionResult[];
  overall_score?: number;
  elapsed_seconds?: number;
  notes?: string;
  result?: TestResult;
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
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export interface SkillTestListItem {
  id: string;
  template_name: string;
  candidate_name: string;
  examiner_name: string;
  status: SkillTestStatus;
  result: TestResult;
  is_practice: boolean;
  overall_score?: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface SkillTestingSummary {
  total_templates: number;
  published_templates: number;
  total_tests: number;
  tests_this_month: number;
  pass_rate: number | null;
  average_score: number | null;
}
