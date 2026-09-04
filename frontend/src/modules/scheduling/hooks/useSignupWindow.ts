/**
 * The department's signup window, from the once-per-session settings load.
 *
 * A hook rather than a prop threaded through MonthGrid -> PhoneMonth ->
 * DayDetailPanel -> ShiftSeatList: the rules in `shiftBoard.ts` stay pure and
 * testable, and each component that calls them reads the store itself rather
 * than four others forwarding a value they never use.
 *
 * Returns the permissive default until the settings land, so a board painted
 * before the fetch completes does not disable a button the server would have
 * accepted.
 */

import { useEffect, useMemo } from 'react';
import { useSchedulingStore } from '../store/schedulingStore';
import { DEFAULT_SIGNUP_WINDOW, type SignupWindow } from '../utils/shiftBoard';

export const useSignupWindow = (): SignupWindow => {
  const settingsLoaded = useSchedulingStore((s) => s.settingsLoaded);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const closesMinutesBefore = useSchedulingStore((s) => s.signupClosesMinutesBefore);
  const graceMinutes = useSchedulingStore((s) => s.lateSignupGraceMinutes);

  // The hook fetches rather than assuming a parent did. Four screens gate a
  // claim button on this window and only two of them happened to load the
  // settings; a screen that forgot would silently keep the permissive default
  // and offer a button the server refuses. `loadSettings` is a no-op once the
  // settings are in, so this costs one request per session.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return useMemo(
    () => (settingsLoaded ? { closesMinutesBefore, graceMinutes } : DEFAULT_SIGNUP_WINDOW),
    [settingsLoaded, closesMinutesBefore, graceMinutes]
  );
};

export default useSignupWindow;
