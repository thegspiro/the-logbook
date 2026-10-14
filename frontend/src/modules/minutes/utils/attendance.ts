import type { AttendanceStatus, AttendeeEntry } from '../types/minutes';

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
