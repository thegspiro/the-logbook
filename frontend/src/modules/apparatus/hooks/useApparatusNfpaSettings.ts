import { useCallback, useEffect, useState } from 'react';
import { apparatusNfpaService } from '../services/api';
import type { ApparatusNfpaSettings } from '../types';

interface UseApparatusNfpaSettingsReturn {
  /** False until the server has said otherwise, and on any failure. */
  enabled: boolean;
  /** The full answer, for the screen that changes it; null until loaded. */
  settings: ApparatusNfpaSettings | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Whether this department tracks NFPA apparatus compliance.
 *
 * Asks the server rather than reading organization settings, so the
 * organization-type default lives in one place (`app/utils/apparatus_nfpa.py`).
 * Fails closed: a failed read hides the NFPA controls, which is what the server
 * would do with every NFPA request anyway.
 */
export function useApparatusNfpaSettings(): UseApparatusNfpaSettingsReturn {
  const [settings, setSettings] = useState<ApparatusNfpaSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSettings(await apparatusNfpaService.getSettings());
    } catch {
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { enabled: settings?.enabled === true, settings, loading, refresh };
}
