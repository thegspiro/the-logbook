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
  description?: string;
  type: CriterionType;
  required: boolean;
  sort_order: number;
  /** For 'score' type: minimum passing score */
  passing_score?: number;
  /** For 'score' type: maximum possible score */
  max_score?: number;
  /** For 'time_limit' type: max seconds allowed */
  time_limit_seconds?: number;
  /** For 'checklist' type: items that must be checked */
  checklist_items?: string[];
  /** For 'statement' type: text the evaluator must read/state */
  statement_text?: string;
}

/** A section grouping related criteria within a template */
export interface SkillTemplateSection {
  id: string;
  name: string;
  description?: string;
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
  description?: string;
  category?: string;
  sections: SkillTemplateSectionCreate[];
  time_limit_seconds?: number;
  passing_percentage?: number;
  require_all_critical?: boolean;
  tags?: string[];
  visibility?: TemplateVisibility;
}

export interface SkillTemplateSectionCreate {
  name: string;
  description?: string;
  sort_order: number;
  criteria: SkillCriterionCreate[];
}

export interface SkillCriterionCreate {
  label: string;
  description?: string;
  type: CriterionType;
  required: boolean;
  sort_order: number;
  passing_score?: number;
  max_score?: number;
  time_limit_seconds?: number;
  checklist_items?: string[];
  statement_text?: string;
}

export interface SkillTemplateUpdate {
  name?: string;
  description?: string;
  category?: string;
  status?: TemplateStatus;
  visibility?: TemplateVisibility;
  sections?: SkillTemplateSectionCreate[];
  time_limit_seconds?: number | null;
  passing_percentage?: number | null;
  require_all_critical?: boolean;
  tags?: string[];
}

// ==================== Active Test Types ====================

/** Result for a single criterion during a test */
export interface CriterionResult {
  criterion_id: string;
  /** Sent to backend for name-based result matching */
  criterion_label?: string;
  passed: boolean | null;
  score?: number;
  time_seconds?: number;
  checklist_completed?: boolean[];
  notes?: string;
}

/** Results for a section during a test */
export interface SectionResult {
  section_id: string;
  /** Sent to backend for name-based result matching */
  section_name?: string;
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
  overall_score?: number;
  /** Total elapsed time in seconds */
  elapsed_seconds?: number;
  notes?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  /** Template sections for active test rendering (from API response) */
  template_sections?: SkillTemplateSection[];
  /** Template global time limit in seconds */
  template_time_limit_seconds?: number;
}

export interface SkillTestCreate {
  template_id: string;
  candidate_id: string;
  notes?: string;
  is_practice?: boolean;
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
  pass_rate: number;
  average_score: number;
}
