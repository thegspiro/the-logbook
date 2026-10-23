/**
 * Workflow review W79: My Training printed a record's stored status code
 * ("completed", "in progress" with only its first underscore replaced).
 */

import { describe, it, expect } from 'vitest';
import { getTrainingStatusLabel } from './trainingColors';

describe('getTrainingStatusLabel (W79)', () => {
  it('names the record, enrolment and submission statuses', () => {
    expect(getTrainingStatusLabel('completed')).toBe('Completed');
    expect(getTrainingStatusLabel('in_progress')).toBe('In progress');
    expect(getTrainingStatusLabel('pending_review')).toBe('Pending review');
    expect(getTrainingStatusLabel('revision_requested')).toBe('Revision requested');
  });

  it('reads an unknown status as itself, every underscore replaced', () => {
    expect(getTrainingStatusLabel('on_extended_leave')).toBe('on extended leave');
  });
});
