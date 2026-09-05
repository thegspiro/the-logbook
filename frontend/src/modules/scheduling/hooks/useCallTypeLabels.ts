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

/**
 * Whether a shift report's stored call types are this org's type slugs.
 *
 * The column holds two different things. Count-only tracking writes the org's
 * slugs, which resolve through the department's label list; detailed tracking
 * writes the incident text an officer typed, which is shown verbatim —
 * relabelling it would rewrite their words the day a type whose slug happens
 * to match gets renamed. A report written before the backend recorded this
 * carries neither marker and is treated as verbatim, which is what it
 * rendered as before labels existed.
 */
export const callTypesAreOrgSlugs = (report: { data_sources?: Record<string, string> | undefined }): boolean =>
  report.data_sources?.['call_types'] === 'org_calls';

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

/**
 * Whether the label map has actually arrived.
 *
 * Only the print view needs this. It fires `window.print()` on a timer once
 * the report loads, and the settings request races that timer — a print
 * snapshot taken first shows raw slugs, and no later state update can repair
 * a page that has already gone to the printer.
 */
export const useCallTypeLabelsReady = (): boolean => useSchedulingStore((s) => s.settingsLoaded);

export default useCallTypeLabels;
