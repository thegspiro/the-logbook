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
