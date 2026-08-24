/**
 * Shared shapes and formatting for the Submit External Training screen.
 *
 * Length is entered as a start time plus a duration and the hours are derived
 * from the pair, so every consumer of that arithmetic reads it from here
 * rather than re-deriving it.
 */

export const DURATION_STEP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;
export const DEFAULT_DURATION_MINUTES = 240;
/**
 * Ceiling for the stepper when the department has set no maximum (the column
 * is nullable and null means "no limit"). A single entry is a start time plus
 * a length, so a day is its natural bound; a longer course is logged one day
 * at a time, which is what the copy at the ceiling says.
 */
export const UNCONFIGURED_MAX_HOURS = 24;
export const QUICK_DURATIONS = [60, 120, 240, 480];

/** A photo of a paper certificate is the expected case, so images count. */
export const ATTACHMENT_ACCEPT = 'application/pdf,image/jpeg,image/png';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** "4h", "2h 30m", "45m" — the duration readout and the rail's hours figure. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0h';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!mins) return `${hours}h`;
  if (!hours) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

export function timeToMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!match) return null;
  const hours = parseInt(match[1] ?? '', 10);
  const mins = parseInt(match[2] ?? '', 10);
  if (isNaN(hours) || isNaN(mins) || hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

export function minutesToTime(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** Hours as the API stores them: duration in minutes, to two decimals. */
export function durationToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function attachmentRejection(file: File): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) return 'That file is over 10 MB. Try a smaller scan or photo.';
  // An empty or unfamiliar `File.type` is the browser's gap, not the member's:
  // some OS/browser pairs report nothing for a perfectly good PDF. The upload
  // endpoint reads the magic bytes and does not trust this value anyway, so
  // only a type we positively recognise as wrong is turned away here.
  if (file.type && !ATTACHMENT_ACCEPT.split(',').includes(file.type)) {
    return 'Attach a PDF, JPG, or PNG.';
  }
  return null;
}

/** A field is complete when the member has actually put something in it. */
export interface ChecklistRow {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
}

/** What the confirmation screen prints back after a successful submission. */
export interface Receipt {
  rows: { key: string; value: string }[];
  approved: boolean;
}
