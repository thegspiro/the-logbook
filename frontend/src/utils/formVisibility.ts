/**
 * Conditional visibility for custom-form fields ("branching questions").
 *
 * This is the one frontend definition of the rule. `FormRenderer` and
 * `PublicFormPage` both call it, and it must stay identical to
 * `FormsService._visible_field_ids` in `backend/app/services/forms_service.py`:
 * if the two disagree, the browser hides a required question the server still
 * demands (a form nobody can submit), or shows one the server then discards.
 *
 * A field is shown only when its own rule passes **and** the question it
 * branches from is shown. An answer typed into a question that has since been
 * hidden is stale — it belongs to a branch the submitter backed out of — so it
 * must not keep that branch's follow-up questions on screen, and above all must
 * not keep a required one demanding an answer.
 */
import { FieldType } from '../constants/enums';

export interface ConditionalField {
  id: string;
  field_type: string;
  condition_field_id?: string | null | undefined;
  condition_operator?: string | null | undefined;
  condition_value?: string | null | undefined;
}

/** Operators whose rule compares against `condition_value`. */
export const CONDITION_OPERATORS_WITH_VALUE: readonly string[] = ['equals', 'not_equals', 'contains'];

const MULTI_VALUE_TYPES: readonly string[] = [FieldType.CHECKBOX, FieldType.MULTISELECT];

/**
 * Whether `field`'s own rule passes against its parent's answer, ignoring
 * whether the parent itself is shown.
 *
 * Checkbox and multi-select answers are stored comma-joined, so "contains"
 * against them matches a whole selected option rather than a substring:
 * picking "AEMT" must not satisfy "contains EMT". An unrecognised operator
 * counts as passing, so a bad rule fails closed — the question stays on screen
 * (and stays required) rather than silently disappearing.
 */
export function conditionMatches(
  field: ConditionalField,
  parentRawValue: string | undefined,
  parentFieldType?: string
): boolean {
  const parentValue = (parentRawValue || '').trim();
  const expected = field.condition_value || '';

  switch (field.condition_operator) {
    case 'equals':
      return parentValue === expected;
    case 'not_equals':
      return parentValue !== expected;
    case 'contains': {
      if (!expected) return true;
      const needle = expected.toLowerCase();
      if (parentFieldType && MULTI_VALUE_TYPES.includes(parentFieldType)) {
        return parentValue
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .some((part) => part === needle);
      }
      return parentValue.toLowerCase().includes(needle);
    }
    case 'not_empty':
      return parentValue.length > 0;
    case 'is_empty':
      return parentValue.length === 0;
    default:
      return true;
  }
}

/**
 * The ids of every field shown for `values`, following branches through any
 * number of levels.
 *
 * A rule that names a field no longer on the form is judged against an empty
 * answer, as it always has been. A cycle (A shows when B…, B shows when A…) is
 * broken by not looking past the field already being resolved; the builder and
 * the API refuse to create one, so this only guards rows written before they
 * did.
 */
export function getVisibleFieldIds<T extends ConditionalField>(
  fields: readonly T[],
  values: Readonly<Record<string, string>>
): Set<string> {
  const byId = new Map(fields.map((f) => [f.id, f]));

  const isShown = (field: T, resolving: Set<string>): boolean => {
    const parentId = field.condition_field_id;
    if (!parentId || !field.condition_operator) return true;

    const parent = byId.get(parentId);
    if (parent && !resolving.has(parent.id)) {
      const next = new Set(resolving);
      next.add(field.id);
      if (!isShown(parent, next)) return false;
    }
    return conditionMatches(field, values[parentId], parent?.field_type);
  };

  const visible = new Set<string>();
  for (const field of fields) {
    if (isShown(field, new Set([field.id]))) visible.add(field.id);
  }
  return visible;
}

/**
 * The ids of `fieldId` and every field that branches from it, directly or
 * through other branches. The builder removes these from the list of questions
 * a field may branch from, since choosing one would create a cycle.
 */
export function getDescendantFieldIds(fields: readonly ConditionalField[], fieldId: string): Set<string> {
  const found = new Set<string>([fieldId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const field of fields) {
      if (field.condition_field_id && found.has(field.condition_field_id) && !found.has(field.id)) {
        found.add(field.id);
        grew = true;
      }
    }
  }
  return found;
}
