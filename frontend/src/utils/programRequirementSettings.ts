/**
 * The per-program settings an officer gives a requirement link: a due date
 * counted from enrollment, the description members see in place of the
 * requirement's own, and a message emailed when they complete it.
 *
 * Form state keeps all three as strings (what the inputs hold). Create and
 * update want opposite things from a blank box — see `utils/formValues.ts`:
 * a create omits it, an update sends `null` so the stored value is cleared.
 */
import { blankToNull, numberOrNull } from './formValues';

export interface ProgramRequirementSettingsForm {
  custom_deadline_days: string;
  program_specific_description: string;
  notification_message: string;
}

/** The backend bound (`MAX_CUSTOM_DEADLINE_DAYS`), ten years. */
export const MAX_CUSTOM_DEADLINE_DAYS = 3650;

export const emptyProgramRequirementSettings = (): ProgramRequirementSettingsForm => ({
  custom_deadline_days: '',
  program_specific_description: '',
  notification_message: '',
});

export const programRequirementSettingsFrom = (link?: {
  custom_deadline_days?: number | null | undefined;
  program_specific_description?: string | null | undefined;
  notification_message?: string | null | undefined;
}): ProgramRequirementSettingsForm => ({
  custom_deadline_days: link?.custom_deadline_days != null ? String(link.custom_deadline_days) : '',
  program_specific_description: link?.program_specific_description ?? '',
  notification_message: link?.notification_message ?? '',
});

const wholeDays = (value: string): number | undefined => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Create / build payload: blanks are omitted. */
export const toProgramRequirementSettingsCreate = (form: ProgramRequirementSettingsForm) => ({
  custom_deadline_days: wholeDays(form.custom_deadline_days.trim()) || undefined,
  program_specific_description: form.program_specific_description.trim() || undefined,
  notification_message: form.notification_message.trim() || undefined,
});

/** Update payload: every field the form owns, a blank one as `null`. */
export const toProgramRequirementSettingsUpdate = (form: ProgramRequirementSettingsForm) => ({
  custom_deadline_days: numberOrNull(form.custom_deadline_days.trim()),
  program_specific_description: blankToNull(form.program_specific_description),
  notification_message: blankToNull(form.notification_message),
});

/** A message for an invalid deadline, or null when the value is acceptable. */
export const programRequirementSettingsError = (form: ProgramRequirementSettingsForm): string | null => {
  const raw = form.custom_deadline_days.trim();
  if (!raw) return null;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_CUSTOM_DEADLINE_DAYS) {
    return `Due-after-enrollment days must be a whole number from 1 to ${MAX_CUSTOM_DEADLINE_DAYS}`;
  }
  return null;
};
