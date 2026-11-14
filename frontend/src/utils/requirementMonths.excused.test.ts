import { describe, it, expect } from 'vitest';
import { excusedMonthsPhrase } from './requirementMonths';
import type { RequirementDetail } from '../types/training';

const req = (overrides: Partial<RequirementDetail>): RequirementDetail => ({
  id: 'req-1',
  name: 'Hours',
  frequency: 'annual',
  required_hours: 6,
  completed_hours: 0,
  progress_percentage: 0,
  is_met: false,
  ...overrides,
});

describe('excusedMonthsPhrase', () => {
  it('names leave only where a leave of absence was the reason', () => {
    expect(excusedMonthsPhrase(req({ waived_months: 11, leave_months: 11 }))).toBe('11 months on leave');
    expect(excusedMonthsPhrase(req({ waived_months: 1, waiver_months: 1 }))).toBe('1 waived month');
    expect(excusedMonthsPhrase(req({ waived_months: 3, leave_months: 2, waiver_months: 1 }))).toBe(
      '2 months on leave and 1 waived month'
    );
  });

  it('keeps the old wording for a server that does not split the count', () => {
    expect(excusedMonthsPhrase(req({ waived_months: 10 }))).toBe('10 waived months of leave');
  });
});
