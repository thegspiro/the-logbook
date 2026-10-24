import type React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RSVP } from '../types/event';

const mockOverrideAttendance = vi.fn();
vi.mock('../services/api', () => ({
  eventService: {
    overrideAttendance: (...args: unknown[]) => mockOverrideAttendance(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

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

  it('pre-fills the credited check-in, not an early tap', () => {
    // An override is never clamped to the scheduled start, so pre-filling the
    // 17:20 tap would make an unchanged save credit forty extra minutes.
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
          checked_in: true,
          checked_in_at: '2030-04-15T17:20:00Z',
          credited_check_in_at: '2030-04-15T18:00:00Z',
        })
      )
    );

    expect(result.current.overrideCheckIn).toBe('2030-04-15T18:00');
  });
});

describe('useOverrideAttendance handleSubmit', () => {
  beforeEach(() => {
    mockOverrideAttendance.mockReset();
    mockOverrideAttendance.mockResolvedValue(rsvp());
  });

  const submitEvent = { preventDefault: () => undefined } as React.FormEvent;

  it('sends an emptied time as null so the stored override is cleared', async () => {
    const { result } = renderHook(() =>
      useOverrideAttendance({ eventId: 'event-1', timezone: 'UTC', onSuccess: vi.fn().mockResolvedValue(undefined) })
    );

    act(() =>
      result.current.openModal(
        rsvp({ override_check_in_at: '2030-04-15T18:10:00Z', override_check_out_at: '2030-04-15T19:25:00Z' })
      )
    );
    act(() => result.current.setOverrideCheckOut(''));
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    expect(mockOverrideAttendance).toHaveBeenCalledWith('event-1', 'user-1', {
      override_check_in_at: '2030-04-15T18:10:00.000Z',
      override_check_out_at: null,
    });
  });

  it('sends both times when both are filled', async () => {
    const { result } = renderHook(() =>
      useOverrideAttendance({ eventId: 'event-1', timezone: 'UTC', onSuccess: vi.fn().mockResolvedValue(undefined) })
    );

    act(() => result.current.openModal(rsvp()));
    act(() => {
      result.current.setOverrideCheckIn('2030-04-15T18:00');
      result.current.setOverrideCheckOut('2030-04-15T20:00');
    });
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    expect(mockOverrideAttendance).toHaveBeenCalledWith('event-1', 'user-1', {
      override_check_in_at: '2030-04-15T18:00:00.000Z',
      override_check_out_at: '2030-04-15T20:00:00.000Z',
    });
  });
});
