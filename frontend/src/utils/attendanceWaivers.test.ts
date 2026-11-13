import { describe, it, expect } from 'vitest';
import { capSummary, closesUndecidedText, latestDecisionNote } from './attendanceWaivers';
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

describe('closesUndecidedText', () => {
  // 05:00Z on 28 November is midnight in New York: the end of the 27th.
  const expiresAt = '2026-11-28T05:00:00Z';

  it('words the backend’s instant in the department’s timezone for a pending request', () => {
    expect(closesUndecidedText({ status: 'pending', expires_at: expiresAt }, 'America/New_York')).toMatch(
      /^Closes undecided on Saturday, November 28, 2026,? (at )?12:00\sAM$/
    );
  });

  it('is null once the request is settled, or when the server gave no instant', () => {
    expect(closesUndecidedText({ status: 'expired', expires_at: expiresAt }, 'UTC')).toBeNull();
    expect(closesUndecidedText({ status: 'approved', expires_at: expiresAt }, 'UTC')).toBeNull();
    expect(closesUndecidedText({ status: 'pending', expires_at: null }, 'UTC')).toBeNull();
    expect(closesUndecidedText({ status: 'pending' }, 'UTC')).toBeNull();
  });
});
