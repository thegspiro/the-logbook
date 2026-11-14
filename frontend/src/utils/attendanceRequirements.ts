import type { TrainingRequirement } from '../types/training';

/** The session-attendance requirements on offer, from a list of any kind. */
export const attendanceRequirements = (requirements: TrainingRequirement[]): TrainingRequirement[] =>
  requirements.filter((r) => r.requirement_type === 'session_attendance');
