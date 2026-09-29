import type { EventTrainingDetails } from '../../types/event';

/**
 * The training details a Training event can carry, as form state. Every field
 * is a string and `''` means "not picked", so the value can back plain selects
 * without `undefined` juggling; the payload helpers below turn it into wire
 * shape.
 *
 * Kept apart from `TrainingDetailsFields.tsx` so that file exports only its
 * component, which is what React Fast Refresh needs to hot-swap it.
 */
export interface TrainingDetailsValue {
  course_id: string;
  category_id: string;
  program_id: string;
  phase_id: string;
  requirement_id: string;
  training_type: string;
}

export const EMPTY_TRAINING_DETAILS: TrainingDetailsValue = {
  course_id: '',
  category_id: '',
  program_id: '',
  phase_id: '',
  requirement_id: '',
  training_type: '',
};

const DETAIL_KEYS = [
  'course_id',
  'category_id',
  'program_id',
  'phase_id',
  'requirement_id',
  'training_type',
] as const satisfies ReadonlyArray<keyof TrainingDetailsValue>;

/** True when the officer picked anything at all. */
export const hasExplicitTrainingDetails = (value: TrainingDetailsValue): boolean =>
  DETAIL_KEYS.some((key) => value[key].trim() !== '');

/**
 * Create-payload semantics: a blank field is omitted rather than sent as `''`,
 * which the backend would reject as a malformed id (CLAUDE.md pitfall #1). An
 * update needs explicit nulls instead — the event page's card builds its own.
 */
export const toTrainingDetailsPayload = (value: TrainingDetailsValue): EventTrainingDetails => {
  const payload: EventTrainingDetails = {};
  for (const key of DETAIL_KEYS) {
    const picked = value[key].trim() || undefined;
    if (picked) payload[key] = picked;
  }
  return payload;
};
