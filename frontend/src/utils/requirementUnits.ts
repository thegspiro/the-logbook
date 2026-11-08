/**
 * The unit a requirement's progress figure counts.
 *
 * `completed_hours` / `required_hours` on a requirement detail are hours only
 * for an `hours` requirement: the backend's evaluator puts the courses
 * completed, shifts worked or calls run in the same two fields
 * (`TrainingService.evaluate_requirement_detail`). Labelling them all "hrs"
 * showed a four-course requirement as "0/4 hrs". Certification and the
 * remaining types are graded 0 or 1 and get no unit.
 */

import type { RequirementType } from '../types/training';

const UNITS: Partial<Record<RequirementType, [singular: string, plural: string]>> = {
  hours: ['hr', 'hrs'],
  courses: ['course', 'courses'],
  shifts: ['shift', 'shifts'],
  calls: ['call', 'calls'],
  session_attendance: ['session', 'sessions'],
};

/**
 * The unit for `count` of a requirement of `type`, or `''` for a type graded
 * as done or not done. An absent type reads as hours, which is what every
 * requirement was labelled before the type was sent.
 */
export function requirementUnit(type: RequirementType | undefined, count: number): string {
  const unit = UNITS[type ?? 'hours'];
  if (!unit) return '';
  return count === 1 ? unit[0] : unit[1];
}
