import { useState, useEffect } from 'react';
import { organizationService } from '../services/api';

/**
 * Modules that are always present in the enabled-modules response. If the
 * response contains only these, the organization has almost certainly not
 * configured its modules yet, and hiding every optional module would leave a
 * near-empty navigation — so that case is treated as "unconfigured, show all".
 */
const ESSENTIAL_ONLY = new Set(['members', 'events', 'documents', 'roles', 'settings']);

export interface EnabledModules {
  /** null while loading, on error, or when the org has no module config yet. */
  enabledModules: Set<string> | null;
  /** Should this module's navigation be shown? Permissive when unconfigured. */
  isModuleOn: (key: string) => boolean;
}

/**
 * Loads the organization's enabled modules for navigation gating.
 *
 * Shared by every navigation surface (side, top and bottom) so the
 * "unconfigured means show everything" heuristic lives in one place. The
 * underlying GET goes through the global axios cache, so mounting this in
 * several components does not mean several round trips.
 */
export function useEnabledModules(): EnabledModules {
  const [enabledModules, setEnabledModules] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    organizationService
      .getEnabledModules()
      .then((res) => {
        if (cancelled) return;
        const hasConfigurable = res.enabled_modules.some((m) => !ESSENTIAL_ONLY.has(m));
        setEnabledModules(hasConfigurable ? new Set(res.enabled_modules) : null);
      })
      .catch(() => {
        /* default to null = show all */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isModuleOn = (key: string) => enabledModules === null || enabledModules.has(key);

  return { enabledModules, isModuleOn };
}
