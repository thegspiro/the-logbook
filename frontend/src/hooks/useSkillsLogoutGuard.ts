/**
 * Ask before a sign-out destroys scored skills evaluations (owner decision,
 * skills-offline-logout-purge).
 *
 * Logout purges every offline store (FE-6/FE-7) because the next person at a
 * shared station could otherwise read what is left behind. For an equipment
 * check that is the right trade; for a scored evaluation of a candidate who has
 * already gone home it is not, so a sign-out with scorecards still on the
 * device is blocked behind a warning. Sending them first is tried when there
 * is signal; what cannot be sent is the examiner's call to keep (stay signed
 * in) or to delete (sign out anyway).
 *
 * Only an interactive sign-out can ask. The idle timeout and an expired
 * session still purge without asking — see KNOWN_LIMITATIONS.md.
 */

import { useCallback } from 'react';
import { useConfirm } from '../contexts/ConfirmContext';
import { skillsPendingCount } from '../utils/skillsTestOffline';
import { drainSkillsTests } from './useOfflineSyncEngine';

async function pendingNow(): Promise<number> {
  try {
    return await skillsPendingCount();
  } catch {
    // An unreadable store has nothing this guard can save.
    return 0;
  }
}

/** Resolves true when sign-out may go ahead. */
export function useSkillsLogoutGuard(): () => Promise<boolean> {
  const { confirm } = useConfirm();
  return useCallback(async () => {
    let pending = await pendingNow();
    if (pending > 0 && typeof navigator !== 'undefined' && navigator.onLine) {
      await drainSkillsTests();
      pending = await pendingNow();
    }
    if (pending === 0) return true;
    const what = pending === 1 ? '1 skills evaluation' : `${pending} skills evaluations`;
    return confirm({
      title: 'Scored evaluations have not been sent',
      message: `${what} scored on this device ${pending === 1 ? 'has' : 'have'} not reached the server. Signing out deletes ${pending === 1 ? 'it' : 'them'} from this device and the scoring cannot be recovered. Stay signed in until the device has signal and ${pending === 1 ? 'it syncs' : 'they sync'}.`,
      confirmLabel: 'Sign out and delete',
      cancelLabel: 'Stay signed in',
      variant: 'danger',
    });
  }, [confirm]);
}
