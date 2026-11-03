/**
 * useConnectedIntegrations Hook
 *
 * Fetches the organization's integrations and exposes a quick predicate for
 * whether a given integration type is currently connected. Used by feature
 * modules (e.g. the membership pipeline) to conditionally offer integration-
 * backed options only when the department has actually connected that service.
 *
 * Failures are treated as "nothing connected" — an unreachable integrations
 * list must never block the surrounding UI, only hide the optional affordance.
 */
import { useState, useEffect, useCallback } from 'react';
import { integrationsService } from '../services/api';
import { useEnabledModules } from './useEnabledModules';

interface UseConnectedIntegrationsResult {
  /** Set of integration_type values whose status is "connected". */
  connected: Set<string>;
  /** True until the first fetch resolves (or fails). */
  loading: boolean;
  /** Convenience predicate for a single integration type. */
  isConnected: (integrationType: string) => boolean;
}

interface UseConnectedIntegrationsOptions {
  /**
   * False skips the request and reports nothing connected — for a caller whose
   * own permission makes the answer irrelevant. The Integrations module switch
   * is checked here regardless, so a caller need not pass it.
   */
  enabled?: boolean;
}

export const useConnectedIntegrations = ({
  enabled = true,
}: UseConnectedIntegrationsOptions = {}): UseConnectedIntegrationsResult => {
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // The endpoint sits behind the Integrations module gate and answers 403 when
  // the department has it off. Only the navigation bars used to check, so the
  // dozen other callers drew a refused request on every load of a fresh
  // install that skipped the module (workflow reviews W07 and W01).
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const shouldFetch = enabled && isModuleOn('integrations');

  useEffect(() => {
    if (modulesLoading) return undefined;
    if (!shouldFetch) {
      setConnected(new Set());
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    integrationsService
      .getConnectedIntegrationStatus()
      .then((items) => {
        if (cancelled) return;
        setConnected(new Set(items.filter((i) => i.status === 'connected').map((i) => i.integration_type)));
      })
      .catch(() => {
        // Swallow — absence of the list simply means no optional affordances.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch, modulesLoading]);

  const isConnected = useCallback((integrationType: string) => connected.has(integrationType), [connected]);

  return { connected, loading, isConnected };
};
