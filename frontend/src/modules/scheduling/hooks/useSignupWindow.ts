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

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSchedulingStore } from '../store/schedulingStore';
import { DEFAULT_SIGNUP_WINDOW, type SignupWindow } from '../utils/shiftBoard';

/**
 * How often the signup rules are re-evaluated against the wall clock.
 *
 * The rules read `Date.now()` during render, so without this a screen left
 * open across a shift's cutoff went on offering the claim button indefinitely
 * — until some unrelated state change forced a repaint — and the member's tap
 * earned a rejection from the server instead of a button that had quietly
 * gone away. Thirty seconds is fine-grained enough that the button disappears
 * about when the shift starts, and coarse enough to be free.
 */
const SIGNUP_CLOCK_INTERVAL_MS = 30_000;

/**
 * One interval shared by every consumer, rather than one per hook call.
 *
 * `useSignupWindow` is called from the board, both calendar variants, the day
 * panel, the detail panel and one seat list per shift, so a timer per instance
 * would mean a dozen on a single screen doing identical work.
 */
const clockSubscribers = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

const subscribeToClock = (onChange: () => void): (() => void) => {
  clockSubscribers.add(onChange);
  if (clockTimer === null) {
    clockTimer = setInterval(() => {
      for (const subscriber of clockSubscribers) subscriber();
    }, SIGNUP_CLOCK_INTERVAL_MS);
  }
  return () => {
    clockSubscribers.delete(onChange);
    if (clockSubscribers.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
};

// Bucketed, so the snapshot is stable between ticks — `useSyncExternalStore`
// re-renders whenever the value changes identity, and a raw `Date.now()` would
// change on every read and loop forever.
const clockSnapshot = (): number => Math.floor(Date.now() / SIGNUP_CLOCK_INTERVAL_MS);

export const useSignupWindow = (): SignupWindow => {
  const settingsLoaded = useSchedulingStore((s) => s.settingsLoaded);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);
  const closesMinutesBefore = useSchedulingStore((s) => s.signupClosesMinutesBefore);
  const graceMinutes = useSchedulingStore((s) => s.lateSignupGraceMinutes);
  const openEndedCushionHours = useSchedulingStore((s) => s.openEndedCushionHours);

  // Re-render the consumer as the clock advances so its signup rules are
  // re-evaluated. The window value itself is unchanged; what goes stale is the
  // `Date.now()` the rules compare it against.
  useSyncExternalStore(subscribeToClock, clockSnapshot, clockSnapshot);

  // The hook fetches rather than assuming a parent did. Four screens gate a
  // claim button on this window and only two of them happened to load the
  // settings; a screen that forgot would silently keep the permissive default
  // and offer a button the server refuses. The store shares one in-flight
  // request across every caller, so the dozen consumers on a board cost one.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return useMemo(
    () => (settingsLoaded ? { closesMinutesBefore, graceMinutes, openEndedCushionHours } : DEFAULT_SIGNUP_WINDOW),
    [settingsLoaded, closesMinutesBefore, graceMinutes, openEndedCushionHours]
  );
};

export default useSignupWindow;
