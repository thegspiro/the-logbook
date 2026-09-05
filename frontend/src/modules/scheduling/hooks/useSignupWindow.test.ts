import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockGetFeatureSettings = vi.fn();

vi.mock('../services/api', () => ({
  schedulingService: {
    getFeatureSettings: (...args: unknown[]) => mockGetFeatureSettings(...args) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  userService: { getUsers: vi.fn() },
}));

import { useSignupWindow } from './useSignupWindow';
import { useSchedulingStore } from '../store/schedulingStore';
import { DEFAULT_SIGNUP_WINDOW, MAX_OPEN_ENDED_CUSHION_HOURS, UNRESOLVED_SIGNUP_WINDOW } from '../utils/shiftBoard';

describe('useSignupWindow', () => {
  beforeEach(() => {
    // This block states the implementation it depends on rather than running
    // on whatever a neighbour left behind (pitfall #28).
    mockGetFeatureSettings.mockReset();
    mockGetFeatureSettings.mockResolvedValue({ platoons_enabled: false });
    useSchedulingStore.setState({
      settingsLoaded: false,
      signupClosesMinutesBefore: DEFAULT_SIGNUP_WINDOW.closesMinutesBefore,
      lateSignupGraceMinutes: DEFAULT_SIGNUP_WINDOW.graceMinutes,
      openEndedCushionHours: DEFAULT_SIGNUP_WINDOW.openEndedCushionHours,
    });
  });

  it('uses the permissive cushion while the settings are unknown', () => {
    // Not the built-in twelve: that is the server's *floor*, which it raises to
    // follow the department's `checkin_closes_hours_after`. A department at
    // seventy-two hours would have had the roster deadline land sixty hours
    // early, hiding claim actions the server still accepts — and because a
    // failed load leaves the settings unloaded with no retry, for as long as
    // the screen is open rather than for one paint.
    const { result } = renderHook(() => useSignupWindow());

    expect(result.current.openEndedCushionHours).toBe(MAX_OPEN_ENDED_CUSHION_HOURS);
    expect(result.current).toEqual(UNRESOLVED_SIGNUP_WINDOW);
  });

  it('uses the department’s own values once they land', () => {
    useSchedulingStore.setState({
      settingsLoaded: true,
      signupClosesMinutesBefore: 45,
      lateSignupGraceMinutes: 15,
      openEndedCushionHours: 24,
    });

    const { result } = renderHook(() => useSignupWindow());

    expect(result.current).toEqual({
      closesMinutesBefore: 45,
      graceMinutes: 15,
      openEndedCushionHours: 24,
    });
  });

  it('keeps the department’s cushion even when it is the floor', () => {
    // The permissive fallback must not survive a real answer that happens to
    // equal the built-in value.
    useSchedulingStore.setState({
      settingsLoaded: true,
      signupClosesMinutesBefore: 0,
      lateSignupGraceMinutes: 60,
      openEndedCushionHours: 12,
    });

    const { result } = renderHook(() => useSignupWindow());

    expect(result.current.openEndedCushionHours).toBe(12);
  });
});
