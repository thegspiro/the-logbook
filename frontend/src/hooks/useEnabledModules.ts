import { useState, useEffect } from 'react';
import { organizationService } from '../services/api';

export interface EnabledModules {
  /**
   * null while loading, on error, or when the organization has no module
   * configuration at all — never merely because everything optional is off.
   */
  enabledModules: Set<string> | null;
  /** Should this module's navigation be shown? Permissive when unconfigured. */
  isModuleOn: (key: string) => boolean;
  /**
   * True until the request settles, either way. `enabledModules` conflates
   * "still loading" with "nothing to gate on", which is right for navigation —
   * a nav bar renders immediately and fills in — but wrong for a route gate,
   * which would flash the page and then replace it with a refusal. Callers
   * that must not render before the answer is known wait on this instead.
   */
  isLoading: boolean;
}

/**
 * Loads the organization's enabled modules for navigation gating.
 *
 * Shared by every navigation surface (side, top and bottom) so the
 * "unconfigured means show everything" heuristic lives in one place.
 *
 * Mounting this in several components costs one round trip, but that is the
 * service's de-duplication doing it, not the response cache: these all mount
 * together, and a cache can only serve a caller that arrives after the first
 * response has landed. This comment used to credit the cache, and the
 * navigation surfaces were quietly making a request each.
 */
export function useEnabledModules(): EnabledModules {
  const [enabledModules, setEnabledModules] = useState<Set<string> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    organizationService
      .getEnabledModules()
      .then((res) => {
        if (cancelled) return;
        // Read the answer rather than infer it. This used to conclude
        // "unconfigured" from an enabled list carrying nothing but the
        // essentials — which is exactly what an organization that has
        // deliberately switched every optional module off also returns. That
        // department got the permissive branch: every gate passed, every
        // disabled route rendered, and the requests behind them failed
        // against the backend gate instead, so the switches appeared to do
        // nothing. The backend now says which case it is.
        setEnabledModules(res.configured ? new Set(res.enabled_modules) : null);
      })
      .catch(() => {
        /* default to null = show all */
      })
      .finally(() => {
        // Settles on failure too: a module flag is not an access control, so a
        // failed lookup has to fall through to "show it" rather than strand a
        // route gate on a spinner forever.
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isModuleOn = (key: string) => enabledModules === null || enabledModules.has(key);

  return { enabledModules, isModuleOn, isLoading };
}
