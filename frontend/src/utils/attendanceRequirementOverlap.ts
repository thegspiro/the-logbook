/**
 * Which other session-attendance requirements leave a member's governing
 * requirement ambiguous once this one is saved.
 *
 * Mirrors `governing_attendance_requirement` in
 * backend/app/services/training_compliance.py: when several session-attendance
 * requirements grade a member, the one naming the member's membership type
 * governs, and if that does not leave exactly one the answer is ambiguous —
 * and the annual review then reports no session-attendance figure for the member.
 *
 * This is a warning shown to the officer, not a decision any screen acts on
 * (pitfall #29 still holds: the backend decides). It looks at membership types
 * only, because those are what the backend's rule narrows by; position,
 * rank and profile scoping can still keep two overlapping requirements apart,
 * so it may warn where the backend would not be ambiguous, never the reverse
 * for membership types alone.
 */

import type { TrainingRequirement } from '../types/training';

const SESSION_ATTENDANCE = 'session_attendance';

type Shape = Pick<TrainingRequirement, 'id' | 'name' | 'requirement_type' | 'active' | 'required_membership_types'>;

/**
 * Two requirements are ambiguous for a member of type T when both apply to T
 * and either both name T or neither does. A requirement that names no type
 * applies to every type, so two of those overlap everywhere; one that names
 * types beside one that names none is settled for its own types (it alone
 * names them) and does not reach the others.
 */
const overlaps = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length === 0 && b.length === 0) return true;
  if (a.length === 0 || b.length === 0) return false;
  return a.some((type) => b.includes(type));
};

export const ambiguousAttendanceRequirements = (saved: Shape, all: readonly Shape[]): Shape[] => {
  if (saved.requirement_type !== SESSION_ATTENDANCE || !saved.active) return [];
  const types = saved.required_membership_types ?? [];
  return all.filter(
    (other) =>
      other.id !== saved.id &&
      other.active &&
      other.requirement_type === SESSION_ATTENDANCE &&
      overlaps(types, other.required_membership_types ?? [])
  );
};

/** The warning for the officer, or null when nothing overlaps. */
export const ambiguousAttendanceWarning = (saved: Shape, all: readonly Shape[]): string | null => {
  const others = ambiguousAttendanceRequirements(saved, all);
  if (others.length === 0) return null;
  const names = others.map((r) => `"${r.name}"`).join(', ');
  return (
    `"${saved.name}" and ${names} grade the same membership types on session attendance. ` +
    'A member they both apply to has no single governing requirement, so their annual review cannot report ' +
    'session attendance until one is narrowed to other membership types or deactivated.'
  );
};
