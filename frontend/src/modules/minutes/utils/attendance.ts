import type { AttendanceListing, AttendanceStatus, AttendeeEntry } from '../types/minutes';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['present', 'late', 'left_early', 'excused', 'absent', 'guest'];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  left_early: 'Left early',
  excused: 'Excused',
  absent: 'Absent',
  guest: 'Guest',
};

/** Rows saved before statuses existed carry only `present`. */
export function statusOf(entry: AttendeeEntry): AttendanceStatus {
  if (entry.status) return entry.status;
  return entry.present ? 'present' : 'absent';
}

export const ATTENDANCE_LISTINGS: AttendanceListing[] = ['present', 'present_excused', 'all'];

export const ATTENDANCE_LISTING_LABELS: Record<AttendanceListing, string> = {
  present: 'Present only',
  present_excused: 'Present and excused',
  all: 'Everyone',
};

/** A guest was in the room, so every listing names guests. */
const LISTED: Record<AttendanceListing, AttendanceStatus[]> = {
  present: ['present', 'late', 'left_early', 'guest'],
  present_excused: ['present', 'late', 'left_early', 'guest', 'excused'],
  all: ATTENDANCE_STATUSES,
};

/** Whether a roll-call status is named under *listing* (mirrors the server's rule). */
export function isListed(status: AttendanceStatus, listing: AttendanceListing): boolean {
  return LISTED[listing].includes(status);
}
