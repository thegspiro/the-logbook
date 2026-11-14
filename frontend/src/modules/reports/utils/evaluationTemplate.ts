/**
 * Pure helpers for the evaluation template builder.
 *
 * Section, item and step keys are what a saved evaluation's answers are filed
 * under, so they are generated once from the label and then kept even when
 * the label is edited — renaming "Training" must not orphan the answers
 * recorded against `training`.
 */

import {
  EvaluationStepType,
  EvaluationTool,
  SCALE_TOOLS,
  SCORED_TOOLS,
  type EvaluationDataSource,
  type GradeBand,
  type ScaleLevel,
  type TemplateDefinition,
  type TemplateItem,
  type TemplateSection,
  type TemplateWorkflow,
  type WorkflowStep,
} from '../types/evaluations';

const KEY_MAX = 50;

/** A key the backend accepts (`^[a-z][a-z0-9_]{0,49}$`), unique among `taken`. */
export function makeKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z]/.test(base)) base = `k_${base}`;
  base = base.slice(0, KEY_MAX).replace(/_+$/, '') || 'k';
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, KEY_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function allItemKeys(definition: TemplateDefinition): string[] {
  return definition.sections.flatMap((section) => section.items.map((item) => item.key));
}

const DEFAULT_LABELS = ['Unsatisfactory', 'Needs improvement', 'Meets expectations', 'Exceeds', 'Exceptional'];

export function defaultLevels(tool: EvaluationTool): ScaleLevel[] {
  if (tool === EvaluationTool.LABELED_SCALE) {
    return DEFAULT_LABELS.map((label, index) => ({ value: index + 1, label, anchor: null }));
  }
  if (tool === EvaluationTool.NUMERIC_SCALE) {
    return [1, 2, 3, 4, 5].map((value) => ({ value, label: String(value), anchor: null }));
  }
  return [];
}

export function newItem(label: string, takenKeys: Iterable<string>): TemplateItem {
  return {
    key: makeKey(label, takenKeys),
    label,
    help_text: null,
    tool: EvaluationTool.LABELED_SCALE,
    levels: defaultLevels(EvaluationTool.LABELED_SCALE),
    allow_na: false,
    weight: 0,
    require_example_for: [],
    checklist_options: [],
    comment: 'optional',
    include_in_self_evaluation: true,
    data_block: null,
  };
}

export function newSection(title: string, takenKeys: Iterable<string>): TemplateSection {
  return { key: makeKey(title, takenKeys), title, description: null, officer_only: false, items: [] };
}

/**
 * Change an item's tool, dropping whatever the new tool cannot carry so the
 * draft still saves: levels belong to scales, weight to rated items, options
 * to checklists, and a scoring rule needs a scale to suggest a level on.
 */
export function withTool(item: TemplateItem, tool: EvaluationTool): TemplateItem {
  const scale = SCALE_TOOLS.includes(tool);
  const keepLevels = scale && SCALE_TOOLS.includes(item.tool) && item.levels.length > 0;
  const levels = scale ? (keepLevels ? item.levels : defaultLevels(tool)) : [];
  const values = new Set(levels.map((level) => level.value));
  return {
    ...item,
    tool,
    levels,
    weight: SCORED_TOOLS.includes(tool) ? item.weight : 0,
    require_example_for: item.require_example_for.filter((v) => values.has(v)),
    checklist_options: tool === EvaluationTool.CHECKLIST ? item.checklist_options : [],
    data_block: item.data_block && !scale ? { ...item.data_block, scoring_rule: null } : item.data_block,
  };
}

/** Sum of the weights on rated items — shown beside the overall setting. */
export function weightTotal(definition: TemplateDefinition): number {
  return definition.sections
    .flatMap((section) => section.items)
    .filter((item) => SCORED_TOOLS.includes(item.tool))
    .reduce((sum, item) => sum + item.weight, 0);
}

/** Sum of the weights on a section's rated items — its share of 100% when the form is graded by section. */
export function sectionItemWeightTotal(section: TemplateSection): number {
  return section.items.filter((item) => SCORED_TOOLS.includes(item.tool)).reduce((sum, item) => sum + item.weight, 0);
}

/** Sum of the sections' weights — shown beside the overall setting when the form is graded by section. */
export function sectionWeightTotal(definition: TemplateDefinition): number {
  return definition.sections.reduce((sum, section) => sum + (section.weight ?? 0), 0);
}

/**
 * The server's default grade ranges (`default_grade_bands`), for a definition
 * that arrived without its own. Every stored definition carries them, so this
 * only fills an older client-built object.
 */
export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { level: 1, min: 1 },
  { level: 2, min: 1.5 },
  { level: 3, min: 2.5 },
  { level: 4, min: 3.5 },
  { level: 5, min: 4.5 },
];

/** Steps appear in this order; approvals may repeat in the middle. */
const STEP_ORDER: Record<EvaluationStepType, number> = {
  self_evaluation: 0,
  evaluator: 1,
  calibration: 2,
  approval: 3,
  member_acknowledgement: 4,
};

/**
 * Insert a step where its type belongs, due no earlier than the step before
 * it, so the workflow the backend validates stays in order.
 */
export function insertStep(workflow: TemplateWorkflow, step: WorkflowStep): TemplateWorkflow {
  const steps = [...workflow.steps];
  let index = steps.findIndex((s) => STEP_ORDER[s.type] > STEP_ORDER[step.type]);
  if (index === -1) index = steps.length;
  const previous = steps[index - 1];
  const next = steps[index];
  let due = Math.max(step.due_days, previous?.due_days ?? 0);
  if (next) due = Math.min(due, next.due_days);
  steps.splice(index, 0, { ...step, due_days: due });
  return { ...workflow, steps };
}

export function hasStep(workflow: TemplateWorkflow, type: EvaluationStepType): boolean {
  return workflow.steps.some((step) => step.type === type);
}

/** Replace the element at `index`, for immutable list edits in the builder. */
export function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((entry, i) => (i === index ? value : entry));
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...list];
  next.splice(to, 0, moved);
  return next;
}

/** A plain-language description of who a template applies to. */
export function describeMatching(memberClass: string | null, memberStatus: string | null): string {
  const cls = memberClass ? `${memberClass.charAt(0).toUpperCase()}${memberClass.slice(1)}` : 'All';
  const status = memberStatus ? ` · ${memberStatus} only` : '';
  return `${cls} members${status}`;
}

/** How the builder names each module's group of data sources. */
const DATA_SOURCE_GROUP_LABELS: Record<string, string> = {
  training: 'Training',
  meetings: 'Business meetings',
  events: 'Events',
  scheduling: 'Shifts',
  calls: 'Calls',
  admin_hours: 'Administrative hours',
  members: 'Membership',
};

export interface DataSourceGroup {
  label: string;
  sources: EvaluationDataSource[];
}

/**
 * The data sources grouped by the module they read, for the builder's
 * dropdown: eighteen entries in one flat list were hard to scan. Groups
 * appear in the order the catalog first names their module, and sources keep
 * the catalog's order within a group, so the server still decides the order.
 * A module this map does not name is grouped under "Other" rather than shown
 * as its storage slug.
 */
export function groupDataSources(sources: readonly EvaluationDataSource[]): DataSourceGroup[] {
  const groups = new Map<string, DataSourceGroup>();
  for (const source of sources) {
    const label = DATA_SOURCE_GROUP_LABELS[source.module] ?? 'Other';
    const group = groups.get(label);
    if (group) group.sources.push(source);
    else groups.set(label, { label, sources: [source] });
  }
  return [...groups.values()];
}
