import { describe, expect, it } from 'vitest';
import { getWaiverStatusBadge } from './waiverStatus';

const TODAY = '2026-10-31';
const label = (start_date: string, end_date: string | null, active = true) =>
  getWaiverStatusBadge({ start_date, end_date, active }, TODAY).label;

describe('getWaiverStatusBadge', () => {
  it('reports a cancelled waiver as inactive whatever its dates', () => {
    expect(label('2026-10-01', '2026-12-01', false)).toBe('Inactive');
  });

  it('reports a waiver that has not started as future', () => {
    expect(label('2026-11-01', '2026-12-01')).toBe('Future');
  });

  it('counts both the first and the last day as in force', () => {
    expect(label(TODAY, '2026-12-01')).toBe('Active');
    expect(label('2026-10-01', TODAY)).toBe('Active');
  });

  it('reports a waiver whose last day has passed as expired', () => {
    expect(label('2026-09-01', '2026-10-30')).toBe('Expired');
  });

  it('reports a started waiver with no end as permanent', () => {
    expect(label('2026-01-01', null)).toBe('Permanent');
  });
});
