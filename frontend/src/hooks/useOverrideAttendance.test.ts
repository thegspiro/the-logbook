import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RSVP } from '../types/event';
import { useOverrideAttendance } from './useOverrideAttendance';

const rsvp = (times: Partial<RSVP> = {}): RSVP => ({
  id: 'rsvp-1',
  event_id: 'event-1',
  user_id: 'user-1',
  status: 'going',
  guest_count: 0,
  responded_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
  checked_in: false,
  ...times,
});

describe('useOverrideAttendance openModal', () => {
  it('falls back to the effective official event times', () => {
    const { result } = renderHook(() =>
      useOverrideAttendance({
        eventId: 'event-1',
        timezone: 'UTC',
        officialStartTime: '2030-04-15T18:00:00Z',
        officialEndTime: '2030-04-15T20:00:00Z',
        onSuccess: vi.fn(),
      })
    );

    act(() => result.current.openModal(rsvp()));

    expect(result.current.overrideCheckIn).toBe('2030-04-15T18:00');
    expect(result.current.overrideCheckOut).toBe('2030-04-15T20:00');
  });

  it('preserves overrides and recorded attendee times ahead of official defaults', () => {
    const { result } = renderHook(() =>
      useOverrideAttendance({
        eventId: 'event-1',
        timezone: 'UTC',
        officialStartTime: '2030-04-15T18:00:00Z',
        officialEndTime: '2030-04-15T20:00:00Z',
        onSuccess: vi.fn(),
      })
    );

    act(() =>
      result.current.openModal(
        rsvp({
          override_check_in_at: '2030-04-15T17:40:00Z',
          checked_in_at: '2030-04-15T17:50:00Z',
          checked_out_at: '2030-04-15T20:10:00Z',
        })
      )
    );

    expect(result.current.overrideCheckIn).toBe('2030-04-15T17:40');
    expect(result.current.overrideCheckOut).toBe('2030-04-15T20:10');
  });
});
