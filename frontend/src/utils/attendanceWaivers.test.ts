import { describe, it, expect } from 'vitest';
import { capSummary, latestDecisionNote } from './attendanceWaivers';
import type { AttendanceWaiverActionEntry } from '../types/attendanceWaiver';

describe('capSummary', () => {
  it('is null with no cap', () => {
    expect(
      capSummary({ cap: null, cap_used: null, cap_remaining: null, cap_period: 'calendar_year', session_date: null })
    ).toBeNull();
  });

  it('counts a calendar-year cap in the session’s year', () => {
    expect(
      capSummary({ cap: 2, cap_used: 2, cap_remaining: 0, cap_period: 'calendar_year', session_date: '2027-01-04' })
    ).toBe('You have used 2 of 2 waivers for 2027 (0 left).');
  });

  it('words a rolling cap without a year', () => {
    expect(
      capSummary({ cap: 1, cap_used: 1, cap_remaining: 0, cap_period: 'rolling_12_months', session_date: '2026-11-20' })
    ).toBe('You have used 1 of 1 waiver in any 12 months that include this session (0 left).');
  });
});

describe('latestDecisionNote', () => {
  const entry = (action: string, note: string | null): AttendanceWaiverActionEntry => ({
    id: action,
    action,
    actor_id: null,
    actor_name: null,
    note,
    created_at: '2026-11-11T00:00:00Z',
  });

  it('reads the override note over the denial it replaced', () => {
    expect(latestDecisionNote([entry('submitted', null), entry('denied', 'No'), entry('chief_override', 'Yes')])).toBe(
      'Yes'
    );
  });

  it('is null before any decision', () => {
    expect(latestDecisionNote([entry('submitted', null)])).toBeNull();
  });
});
