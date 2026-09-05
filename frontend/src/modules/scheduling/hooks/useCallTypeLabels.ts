/**
 * Resolve a stored call type to what the department calls it.
 *
 * Call types are stored as permanent slugs — `mutual_aid`, not "Mutual Aid" —
 * precisely so a department can rename one without orphaning the calls already
 * filed under it. Every screen that displays one therefore has to resolve it,
 * and a screen that forgets shows the storage key.
 *
 * A hook rather than a prop threaded down from each page, following
 * `useSignupWindow`: the settings load is shared and cached once per session,
 * so a report list resolving fifty badges costs one request, and no caller can
 * forget to pass the map.
 *
 * Anything absent from the map is returned unchanged. That covers a type
 * deleted outright, and the detailed-tracking mode where the stored value is
 * already the incident text an officer typed.
 */

import { useCallback, useEffect } from 'react';
import { useSchedulingStore } from '../store/schedulingStore';

export const useCallTypeLabels = (): ((value: string) => string) => {
  const labels = useSchedulingStore((s) => s.callTypeLabels);
  const loadSettings = useSchedulingStore((s) => s.loadSettings);

  // The hook fetches rather than assuming a parent did — the member-facing
  // report page mounts none of the scheduling screens that would have.
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return useCallback((value: string) => labels[value] ?? value, [labels]);
};

export default useCallTypeLabels;
