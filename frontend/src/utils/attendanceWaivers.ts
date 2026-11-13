/**
 * Sentences the session-waiver screens share. Each one only words a figure
 * the backend computed (eligibility's cap counts, the request's decision log);
 * none of them decides anything (CLAUDE.md pitfall #29).
 */

import type {
  AttendanceWaiverActionEntry,
  AttendanceWaiverEligibility,
  AttendanceWaiverRequest,
} from '../types/attendanceWaiver';
import { AttendanceWaiverCapPeriod } from '../constants/enums';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * "You have used 1 of 3 waivers for 2026 (2 left)." — or null with no cap.
 *
 * The year is the session's, not today's: the backend counts a calendar-year
 * cap by the session's date, so a December request asked in January is
 * measured against December's year.
 */
export const capSummary = (
  eligibility: Pick<AttendanceWaiverEligibility, 'cap' | 'cap_used' | 'cap_remaining' | 'cap_period' | 'session_date'>
): string | null => {
  const { cap, cap_used: used, cap_remaining: left, cap_period: period, session_date: sessionDate } = eligibility;
  if (cap === null || used === null || left === null) return null;
  const where =
    period === AttendanceWaiverCapPeriod.ROLLING_12_MONTHS
      ? 'in any 12 months that include this session'
      : `for ${(sessionDate ?? '').slice(0, 4) || 'this year'}`;
  return `You have used ${used} of ${plural(cap, 'waiver')} ${where} (${left} left).`;
};

/** The note the latest decision was recorded with, for the member's card. */
export const latestDecisionNote = (actions: readonly AttendanceWaiverActionEntry[]): string | null => {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const entry = actions[i];
    if (entry && ['approved', 'denied', 'chief_override'].includes(entry.action)) return entry.note || null;
  }
  return null;
};

/** The log entries that make up the question-and-answer exchange, oldest first. */
const CONVERSATION_ACTIONS: ReadonlySet<string> = new Set(['info_requested', 'member_responded']);

/**
 * A decider's questions and the member's answers, in the order the backend
 * logged them. Every round stays, so an earlier answer can still be read.
 */
export const waiverConversation = (actions: readonly AttendanceWaiverActionEntry[]): AttendanceWaiverActionEntry[] =>
  actions.filter((entry) => CONVERSATION_ACTIONS.has(entry.action));

/**
 * The question waiting on the member, or null. Whether one is open is the
 * server's `info_requested_at`; the text is the latest question in the log.
 */
export const openQuestion = (
  request: Pick<AttendanceWaiverRequest, 'info_requested_at' | 'actions'>
): AttendanceWaiverActionEntry | null => {
  if (!request.info_requested_at) return null;
  for (let i = request.actions.length - 1; i >= 0; i -= 1) {
    const entry = request.actions[i];
    if (entry?.action === 'info_requested') return entry;
  }
  return null;
};

export const ATTENDANCE_WAIVER_ACTION_LABELS: Record<string, string> = {
  submitted: 'Asked to be excused',
  withdrawn: 'Withdrew the request',
  approved: 'Approved',
  denied: 'Denied',
  chief_override: 'Approved by Chief override',
  voided: 'Voided',
  info_requested: 'Asked for more information',
  member_responded: 'Answered the question',
  expired: 'Expired undecided',
  rescheduled: 'Session rescheduled',
  member_confirmed: 'Confirmed the new date',
};

/** The decision page every queue row and email button opens. */
export const attendanceWaiverPath = (requestId: string) => `/attendance-waivers/${encodeURIComponent(requestId)}`;

export const ATTENDANCE_WAIVER_QUEUE_PATH = '/attendance-waivers';

/** Matches `MAX_TEXT_LENGTH` in backend/app/schemas/attendance_waiver.py. */
export const WAIVER_TEXT_MAX_LENGTH = 2000;
