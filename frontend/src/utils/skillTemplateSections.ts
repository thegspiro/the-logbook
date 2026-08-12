/**
 * Skill template section hydration.
 *
 * Lives outside the pages that use it so both the examiner-facing active test
 * screen and the member-facing result view can share one implementation —
 * the generated IDs must match between them, since section results are keyed
 * by these IDs.
 */

import type { CriterionType, SkillTemplateSection } from '../types/skillsTesting';

const CRITERION_TYPES: ReadonlySet<string> = new Set<CriterionType>([
  'pass_fail',
  'score',
  'time_limit',
  'checklist',
  'statement',
]);

/**
 * Coerce a stored criterion type to one the examiner screen can render.
 *
 * The screen renders a control per known type and nothing at all for anything
 * else, so an unrecognized type leaves the step with a notes box and no way to
 * mark it — and `require_all_critical` scores an unmarked critical step as a
 * failure. Falling back to pass/fail keeps such a step scorable instead of
 * silently failing the whole evaluation.
 *
 * The API now rejects unknown types outright, so this only ever fires on rows
 * written before that check existed (a seeder wrote `"checkbox"` into every
 * criterion it created). Note `??` cannot do this job: the stored value is a
 * non-null string, so only an explicit membership test catches it.
 */
function normalizeType(raw: unknown): CriterionType {
  return typeof raw === 'string' && CRITERION_TYPES.has(raw) ? (raw as CriterionType) : 'pass_fail';
}

/**
 * Hydrate raw template section JSON (from the API) with stable generated IDs.
 * The backend stores sections/criteria without IDs, so we generate
 * deterministic IDs based on section/criterion indices.
 */
export function hydrateTemplateSections(raw: Record<string, unknown>[] | undefined | null): SkillTemplateSection[] {
  if (!raw) return [];
  return raw.map((section, si) => {
    const criteria = (section.criteria as Record<string, unknown>[] | undefined) ?? [];
    return {
      id: `section-${si}`,
      name: (section.name as string) ?? `Section ${si + 1}`,
      description: section.description as string | undefined,
      sort_order: (section.sort_order as number) ?? si,
      criteria: criteria.map((c, ci) => ({
        id: `criterion-${si}-${ci}`,
        label: (c.label as string) ?? `Criterion ${ci + 1}`,
        description: c.description as string | undefined,
        type: normalizeType(c.type),
        required: (c.required as boolean) ?? false,
        sort_order: (c.sort_order as number) ?? ci,
        passing_score: c.passing_score as number | undefined,
        max_score: c.max_score as number | undefined,
        time_limit_seconds: c.time_limit_seconds as number | undefined,
        checklist_items: c.checklist_items as string[] | undefined,
        statement_text: c.statement_text as string | undefined,
        starts_timer: (c.starts_timer as boolean | undefined) ?? false,
      })),
    };
  });
}
