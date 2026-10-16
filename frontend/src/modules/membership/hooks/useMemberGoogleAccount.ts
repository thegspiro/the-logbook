import { useCallback, useEffect, useState } from 'react';
import { googleAccountService } from '../services/googleAccountService';
import type { GoogleAccount } from '../types/googleAccount';

interface MemberGoogleAccountState {
  account: GoogleAccount | null;
  setAccount: (account: GoogleAccount | null) => void;
  reload: () => Promise<void>;
}

/**
 * The member's account, fetched once by the page so its layout can tell
 * whether there is anything to show before reserving a column for it.
 * Failures read as "no account": this panel is optional and must never block
 * the profile.
 */
export function useMemberGoogleAccount(userId: string | undefined, enabled: boolean): MemberGoogleAccountState {
  const [account, setAccount] = useState<GoogleAccount | null>(null);

  const reload = useCallback(async () => {
    if (!userId || !enabled) {
      setAccount(null);
      return;
    }
    try {
      const data = await googleAccountService.get(userId);
      setAccount(data.account);
    } catch {
      setAccount(null);
    }
  }, [userId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { account, setAccount, reload };
}
