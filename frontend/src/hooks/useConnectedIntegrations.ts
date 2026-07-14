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

interface UseConnectedIntegrationsResult {
  /** Set of integration_type values whose status is "connected". */
  connected: Set<string>;
  /** True until the first fetch resolves (or fails). */
  loading: boolean;
  /** Convenience predicate for a single integration type. */
  isConnected: (integrationType: string) => boolean;
}

export const useConnectedIntegrations = (): UseConnectedIntegrationsResult => {
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    integrationsService
      .getIntegrations()
      .then((items) => {
        if (cancelled) return;
        setConnected(
          new Set(items.filter((i) => i.status === 'connected').map((i) => i.integration_type)),
        );
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
  }, []);

  const isConnected = useCallback(
    (integrationType: string) => connected.has(integrationType),
    [connected],
  );

  return { connected, loading, isConnected };
};
