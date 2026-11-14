/**
 * The budget-request reminder days as an officer types them. The bounds are
 * the backend's (`app/utils/finance_settings.py`), which refuses anything
 * outside them; checked here only so the form can say so before saving.
 */

export const MAX_DAYS = 60;
export const MAX_REMINDERS = 5;

/** "14, 3, 0" -> [14, 3, 0], or an error message. Blank is no reminders. */
export function parseReminderDays(text: string): number[] | string {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part) || Number(part) > MAX_DAYS) {
      return `Each reminder is a whole number of days from 0 to ${MAX_DAYS}.`;
    }
    days.push(Number(part));
  }
  const unique = [...new Set(days)].sort((a, b) => b - a);
  if (unique.length > MAX_REMINDERS) return `At most ${MAX_REMINDERS} reminders.`;
  return unique;
}
