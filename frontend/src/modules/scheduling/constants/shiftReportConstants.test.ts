import { describe, it, expect } from 'vitest';
import { shiftHoursForOneMember } from './shiftReportConstants';

describe('shiftHoursForOneMember', () => {
  // shift.total_hours is the sum of every attendee's minutes. The batch form
  // files one report per crew member, so pre-filling from it credited each
  // rider of a three-person 12-hour shift with 35.6 hours — into requirement
  // progress and the state reports downstream of it.
  it('measures the shift, not the crew', () => {
    expect(
      shiftHoursForOneMember({
        start_time: '2026-07-29T11:00:00Z',
        end_time: '2026-07-29T23:00:00Z',
      })
    ).toBe(12);
  });

  it('handles a shift that runs past midnight', () => {
    expect(
      shiftHoursForOneMember({
        start_time: '2026-07-29T23:00:00Z',
        end_time: '2026-07-30T11:00:00Z',
      })
    ).toBe(12);
  });

  it('keeps a part hour', () => {
    expect(
      shiftHoursForOneMember({
        start_time: '2026-07-29T07:00:00Z',
        end_time: '2026-07-29T13:30:00Z',
      })
    ).toBe(6.5);
  });

  it('returns 0 rather than a guess when the shift has no end', () => {
    expect(shiftHoursForOneMember({ start_time: '2026-07-29T07:00:00Z' })).toBe(0);
    expect(shiftHoursForOneMember({})).toBe(0);
  });

  it('returns 0 for an end that precedes its start', () => {
    expect(
      shiftHoursForOneMember({
        start_time: '2026-07-29T13:00:00Z',
        end_time: '2026-07-29T07:00:00Z',
      })
    ).toBe(0);
  });
});
