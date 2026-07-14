import { describe, it, expect } from 'vitest';
import { requirementTarget } from './pipelineProgress';
import type { RequirementProgressRecord, TrainingRequirementEnhanced } from '../types/training';

function record(
  requirement: Partial<TrainingRequirementEnhanced> | undefined,
  progress_value = 0,
): RequirementProgressRecord {
  return {
    id: 'rp',
    enrollment_id: 'enr',
    requirement_id: 'req',
    status: 'in_progress',
    progress_value,
    progress_percentage: 0,
    created_at: '',
    updated_at: '',
    requirement: requirement as TrainingRequirementEnhanced | undefined,
  };
}

describe('requirementTarget', () => {
  it('counts hours toward the required total', () => {
    expect(requirementTarget(record({ requirement_type: 'hours', required_hours: 24 }, 12))).toBe(
      '12 / 24 hrs',
    );
  });

  it('trims a whole-number decimal but keeps a fractional one', () => {
    expect(requirementTarget(record({ requirement_type: 'hours', required_hours: 24 }, 12.5))).toBe(
      '12.5 / 24 hrs',
    );
  });

  it('counts shifts and calls', () => {
    expect(requirementTarget(record({ requirement_type: 'shifts', required_shifts: 3 }, 2))).toBe(
      '2 / 3 shifts',
    );
    expect(requirementTarget(record({ requirement_type: 'calls', required_calls: 10 }, 4))).toBe(
      '4 / 10 calls',
    );
  });

  it('counts completed courses over the required list length', () => {
    expect(
      requirementTarget(record({ requirement_type: 'courses', required_courses: ['a', 'b', 'c', 'd'] }, 1)),
    ).toBe('1 / 4 courses');
  });

  it('shows the passing threshold for a knowledge test', () => {
    expect(requirementTarget(record({ requirement_type: 'knowledge_test', passing_score: 70 }))).toBe(
      'Pass ≥ 70%',
    );
  });

  it('returns null for status-only types and when the target is missing', () => {
    expect(requirementTarget(record({ requirement_type: 'skills_evaluation' }))).toBeNull();
    expect(requirementTarget(record({ requirement_type: 'certification' }))).toBeNull();
    expect(requirementTarget(record({ requirement_type: 'checklist' }))).toBeNull();
    expect(requirementTarget(record({ requirement_type: 'hours' }))).toBeNull(); // no required_hours
    expect(requirementTarget(record(undefined))).toBeNull();
  });
});
