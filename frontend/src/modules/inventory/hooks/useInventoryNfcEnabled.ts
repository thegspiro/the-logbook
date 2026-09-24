import { useCallback, useEffect, useState } from 'react';
import { inventoryService } from '../../../services/api';

interface UseInventoryNfcEnabledReturn {
  /** False until the server has said otherwise, and on any failure. */
  enabled: boolean;
  loading: boolean;
  /** Re-reads the switch, e.g. after an administrator has just flipped it. */
  refresh: () => Promise<void>;
}

/**
 * Whether the organization has NFC tag tracking switched on.
 *
 * Asks `/inventory/nfc/settings` rather than reading the organization settings
 * object, so the screens depend on the server's reading of the flag (a literal
 * `true`, see `app/utils/inventory_nfc.py`) and not on a second copy of that
 * rule here.
 *
 * Pass `shouldCheck = false` to skip the request entirely; `enabled` stays
 * false.
 *
 * Fails closed: a failed read hides the NFC controls, which is what the server
 * would do with every one of them anyway.
 */
export function useInventoryNfcEnabled(shouldCheck = true): UseInventoryNfcEnabledReturn {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(shouldCheck);

  const refresh = useCallback(async () => {
    try {
      const settings = await inventoryService.getNfcSettings();
      setEnabled(settings.enabled === true);
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // `shouldCheck` lets a screen skip the request for a viewer who could not
  // use NFC anyway, rather than sending one it knows will be refused.
  useEffect(() => {
    if (shouldCheck) void refresh();
  }, [refresh, shouldCheck]);

  return { enabled, loading, refresh };
}
