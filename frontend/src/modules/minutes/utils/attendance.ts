import type { AttendanceListing, AttendanceStatus, AttendeeEntry } from '../types/minutes';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'present',
  'late',
  'left_early',
  'proxy',
  'excused',
  'absent',
  'guest',
];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  left_early: 'Left early',
  proxy: 'Represented by proxy',
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

/**
 * The statuses a roll-call line can be set to. A proxy is offered only where
 * the department uses proxies, but a line already recorded as one stays
 * selectable so switching the setting off does not silently rewrite it.
 */
export function rollStatusesFor(proxyAttendance: boolean, current: AttendanceStatus): AttendanceStatus[] {
  return ATTENDANCE_STATUSES.filter((status) => status !== 'proxy' || proxyAttendance || current === 'proxy');
}

/**
 * A guest was in the room, so every listing names guests; a proxy may have
 * made the quorum, so every listing names who was represented.
 */
const LISTED: Record<AttendanceListing, AttendanceStatus[]> = {
  present: ['present', 'late', 'left_early', 'guest', 'proxy'],
  present_excused: ['present', 'late', 'left_early', 'guest', 'proxy', 'excused'],
  all: ATTENDANCE_STATUSES,
};

/** Whether a roll-call status is named under *listing* (mirrors the server's rule). */
export function isListed(status: AttendanceStatus, listing: AttendanceListing): boolean {
  return LISTED[listing].includes(status);
}
