/**
 * Member Evaluation Types — templates, workflows and review periods.
 *
 * Mirrors `backend/app/schemas/evaluation.py`, which is snake_case like the
 * rest of the reports module. The template definition and workflow are
 * stored in one canonical shape with every field present, so these
 * interfaces declare every field rather than marking any optional: what the
 * server returns is what the builder sends back.
 */

export const EvaluationTemplateKind = {
  ANNUAL: 'annual',
  INTERIM: 'interim',
} as const;
export type EvaluationTemplateKind = (typeof EvaluationTemplateKind)[keyof typeof EvaluationTemplateKind];

export const EvaluationTool = {
  LABELED_SCALE: 'labeled_scale',
  NUMERIC_SCALE: 'numeric_scale',
  MEETS: 'meets',
  CHECKLIST: 'checklist',
  NARRATIVE: 'narrative',
  GOALS: 'goals',
} as const;
export type EvaluationTool = (typeof EvaluationTool)[keyof typeof EvaluationTool];

export const EVALUATION_TOOL_LABELS: Record<EvaluationTool, string> = {
  labeled_scale: 'Labeled scale with behavior descriptions',
  numeric_scale: 'Numeric scale',
  meets: 'Meets / does not meet',
  checklist: 'Checklist',
  narrative: 'Narrative only',
  goals: 'Goals',
};

/** Tools that produce a number, and so can be weighted. */
export const SCORED_TOOLS: readonly EvaluationTool[] = ['labeled_scale', 'numeric_scale', 'meets'];
export const SCALE_TOOLS: readonly EvaluationTool[] = ['labeled_scale', 'numeric_scale'];

export const EvaluationStepType = {
  SELF_EVALUATION: 'self_evaluation',
  EVALUATOR: 'evaluator',
  CALIBRATION: 'calibration',
  APPROVAL: 'approval',
  MEMBER_ACKNOWLEDGEMENT: 'member_acknowledgement',
} as const;
export type EvaluationStepType = (typeof EvaluationStepType)[keyof typeof EvaluationStepType];

export const STEP_TYPE_LABELS: Record<EvaluationStepType, string> = {
  self_evaluation: 'Self-evaluation',
  evaluator: 'Evaluator',
  calibration: 'Calibration',
  approval: 'Approval',
  member_acknowledgement: 'Member acknowledgement',
};

export const StepActorKind = {
  MEMBER: 'member',
  EVALUATOR: 'evaluator',
  POSITION: 'position',
  VIEW_ALL: 'view_all',
} as const;
export type StepActorKind = (typeof StepActorKind)[keyof typeof StepActorKind];

export const MEMBER_CLASS_OPTIONS = [
  { value: 'operational', label: 'Operational' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'social', label: 'Social' },
] as const;

export const MEMBER_STATUS_OPTIONS = [
  { value: 'probationary', label: 'Probationary' },
  { value: 'regular', label: 'Regular' },
  { value: 'life', label: 'Life' },
  { value: 'retired', label: 'Retired' },
  { value: 'honorary', label: 'Honorary' },
  { value: 'junior', label: 'Junior' },
  { value: 'prospective', label: 'Prospective' },
] as const;

export interface ScaleLevel {
  value: number;
  label: string;
  anchor: string | null;
}

export interface ScoreBand {
  min: number;
  /** Exclusive upper bound; null means "and above". */
  max: number | null;
  score: number;
}

export interface DataBlock {
  source: string;
  scoring_rule: { bands: ScoreBand[] } | null;
}

export interface TemplateItem {
  key: string;
  label: string;
  help_text: string | null;
  tool: EvaluationTool;
  levels: ScaleLevel[];
  allow_na: boolean;
  weight: number;
  require_example_for: number[];
  checklist_options: string[];
  comment: 'none' | 'optional' | 'required';
  include_in_self_evaluation: boolean;
  data_block: DataBlock | null;
}

export interface TemplateSection {
  key: string;
  title: string;
  description: string | null;
  officer_only: boolean;
  items: TemplateItem[];
}

export interface TemplateDefinition {
  sections: TemplateSection[];
  overall_mode: 'weighted' | 'evaluator' | 'none';
  officer_ranks: string[];
}

export interface WorkflowStep {
  key: string;
  type: EvaluationStepType;
  label: string;
  actor: { kind: StepActorKind; position_id: string | null };
  due_days: number;
}

export interface TemplateWorkflow {
  steps: WorkflowStep[];
  reminder_days_before: number;
  evaluator_may_proceed_without_self_evaluation: boolean;
  response_window_days: number;
}

export interface TemplateVersion {
  id: string;
  version_number: number;
  published_at: string | null;
  updated_at: string | null;
  definition: TemplateDefinition;
  workflow: TemplateWorkflow;
}

export interface EvaluationTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  kind: EvaluationTemplateKind;
  member_class: string | null;
  member_status: string | null;
  is_active: boolean;
  published_version: number | null;
  has_draft: boolean;
  evaluations_count: number;
  updated_at: string | null;
}

export interface EvaluationTemplateDetail extends EvaluationTemplateSummary {
  draft: TemplateVersion | null;
  published: TemplateVersion | null;
  versions: { id: string; version_number: number; published_at: string | null }[];
}

export interface EvaluationTemplateCreate {
  name: string;
  description?: string | undefined;
  kind: EvaluationTemplateKind;
  member_class?: string | undefined;
  member_status?: string | undefined;
}

/** Partial update: omit to leave alone, null to clear. */
export interface EvaluationTemplateUpdate {
  name?: string;
  description?: string | null;
  member_class?: string | null;
  member_status?: string | null;
  is_active?: boolean;
}

export interface PublishResult {
  published: boolean;
  errors: string[];
  template: EvaluationTemplateDetail | null;
}

export interface EvaluationDataSource {
  key: string;
  label: string;
  unit: 'percent' | 'hours' | 'count' | 'rating' | 'list';
  module: string;
  description: string;
  scoreable: boolean;
}

export interface BuilderOptions {
  positions: { id: string; name: string }[];
  ranks: { rank_code: string; display_name: string; is_active: boolean }[];
}

export interface EvaluationPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
  evaluations_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface EvaluationPeriodCreate {
  name: string;
  start_date: string;
  end_date: string;
}

export interface EvaluationPeriodUpdate {
  name?: string;
  start_date?: string;
  end_date?: string;
  is_closed?: boolean;
}

// ------------------------------------------------------------- evaluations

export const EvaluationPartKind = {
  SELF_EVALUATION: 'self_evaluation',
  EVALUATOR: 'evaluator',
} as const;
export type EvaluationPartKind = (typeof EvaluationPartKind)[keyof typeof EvaluationPartKind];

export const EvaluationStatus = {
  IN_PROGRESS: 'in_progress',
  FINALIZED: 'finalized',
} as const;
export type EvaluationStatus = (typeof EvaluationStatus)[keyof typeof EvaluationStatus];

/** One item's answer, as the server stores it. */
export interface ItemAnswer {
  rating?: number | null | undefined;
  na?: boolean | undefined;
  checked?: string[] | undefined;
  text?: string | null | undefined;
  comment?: string | null | undefined;
  example?: string | null | undefined;
  justification?: string | null | undefined;
}

export interface PartContent {
  answers: Record<string, ItemAnswer>;
  overall_rating?: number | null | undefined;
  overall_comment?: string | null | undefined;
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface EvaluationStep {
  key: string;
  type: EvaluationStepType;
  label: string;
  order: number;
  status: 'pending' | 'open' | 'completed' | 'skipped';
  due_date: string | null;
  completed_at: string | null;
}

export interface EvaluationPart {
  kind: string;
  status: 'draft' | 'submitted';
  content: PartContent;
  submitted_at: string | null;
  updated_at: string | null;
}

export interface ExcludedRange {
  start: string;
  end: string;
  reason: 'leave' | 'separation';
}

/** A data source's measured value: ``value`` is a number, a list of labels,
 * or null when ``available`` is false and ``note`` says why. */
export interface DataEntry {
  available: boolean;
  value: number | { label: string; expires_on?: string | null }[] | null;
  note?: string;
  [extra: string]: unknown;
}

export interface EvaluationSummary {
  id: string;
  member: PersonRef;
  evaluator: PersonRef | null;
  period_id: string | null;
  period_name: string | null;
  period_start: string;
  period_end: string;
  template_name: string;
  kind: EvaluationTemplateKind;
  status: EvaluationStatus;
  current_step: string | null;
  current_step_due: string | null;
  created_at: string | null;
}

export interface EvaluationViewer {
  is_member: boolean;
  is_evaluator: boolean;
  can_edit_self_evaluation: boolean;
  can_edit_evaluation: boolean;
  can_refresh_data: boolean;
  can_calibrate: boolean;
}

export interface EvaluationDetail extends EvaluationSummary {
  coverage_start: string | null;
  coverage_end: string | null;
  excluded_ranges: ExcludedRange[];
  includes_officer_sections: boolean;
  definition: TemplateDefinition;
  overall_levels: ScaleLevel[];
  steps: EvaluationStep[];
  data: Record<string, DataEntry> | null;
  sources: EvaluationDataSource[];
  suggested_scores: Record<string, number>;
  data_taken_at: string | null;
  parts: EvaluationPart[];
  weighted_overall: number | null;
  viewer: EvaluationViewer;
}

export interface SubmitResult {
  outcome: 'submitted' | 'sent_for_calibration' | 'finalized';
  evaluation: EvaluationDetail;
}

export interface EvaluationCreate {
  member_id: string;
  period_id: string;
  evaluator_id?: string | undefined;
  kind: EvaluationTemplateKind;
}

export interface DraftOptions {
  members: PersonRef[];
  evaluators: PersonRef[];
  periods: { id: string; name: string; start_date: string; end_date: string }[];
}

export interface LiveData {
  period_id: string | null;
  period_name: string | null;
  coverage_start: string | null;
  coverage_end: string | null;
  excluded_ranges: ExcludedRange[];
  sources: EvaluationDataSource[];
  data: Record<string, DataEntry>;
  note: string | null;
}
