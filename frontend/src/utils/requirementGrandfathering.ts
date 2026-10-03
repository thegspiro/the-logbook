/**
 * Grandfathering vocabulary for training requirements.
 *
 * A requirement separates members who joined before `new_member_cutoff_date`
 * ("existing members") from those who joined on or after it. The backend
 * (`app/services/training_compliance.py`) decides who is graded; this module
 * only names that decision for the form, the requirement card and the save
 * prompt, so the three describe a requirement in the same words.
 */

import { ExistingMemberPolicy } from '@/constants/enums';
import { formatCalendarDate } from '@/utils/dateFormatting';

/** Accepts a saved requirement or a create payload, which may omit any of these. */
interface GrandfatheringFields {
  new_member_cutoff_date?: string | null | undefined;
  existing_member_deadline?: string | null | undefined;
  applies_to_joined_before?: string | null | undefined;
}

/** The form's three-way choice, derived from the two stored dates. */
export const existingMemberPolicyOf = (req: GrandfatheringFields | null | undefined): ExistingMemberPolicy => {
  if (!req?.new_member_cutoff_date) return ExistingMemberPolicy.APPLY_TO_ALL;
  return req.existing_member_deadline ? ExistingMemberPolicy.CATCH_UP : ExistingMemberPolicy.EXEMPT;
};

/**
 * One line describing who the requirement grades, or null when it grades
 * everyone it matches (the default, which needs no explanation).
 */
export const grandfatheringSummary = (req: GrandfatheringFields): string | null => {
  const parts: string[] = [];
  if (req.applies_to_joined_before) {
    parts.push(`Earlier standard · members who joined before ${formatCalendarDate(req.applies_to_joined_before)}`);
  }
  if (req.new_member_cutoff_date) {
    const cutoff = formatCalendarDate(req.new_member_cutoff_date);
    parts.push(
      req.existing_member_deadline
        ? `Members who joined before ${cutoff} have until ${formatCalendarDate(req.existing_member_deadline)}`
        : `Members who joined before ${cutoff} are exempt`
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

/**
 * Whether a "new members only" save is possible for this requirement.
 *
 * Not for the original of an earlier split: it already holds the old standard
 * for the members who joined before that change, and the backend refuses a
 * second split of it — the newer copy is the one to edit.
 */
export const canSplitForNewMembers = (req: GrandfatheringFields | null | undefined): boolean =>
  !!req && !req.applies_to_joined_before;
