/**
 * Directory account (Google Workspace, Microsoft 365) helpers for the member
 * profile.
 */

import { GoogleAccountStatus } from '../../../constants/enums';
import type { GoogleAccount } from '../types/googleAccount';

/** The integrations that give converted members an account; one at a time. */
export const DIRECTORY_INTEGRATIONS = ['google-workspace', 'microsoft-365'] as const;

const VENDORS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };

/** "Google" or "Microsoft", for sentences such as "the Google account". */
export function directoryVendor(provider: string | undefined): string {
  return VENDORS[provider ?? ''] ?? 'Google';
}

const EXISTS_IN_GOOGLE: ReadonlySet<string> = new Set([
  GoogleAccountStatus.CREATED,
  GoogleAccountStatus.LINKED_EXISTING,
]);

/** What a Retry would do for this account, or null when it has nothing to do. */
export function retryAction(account: GoogleAccount): 'suspension' | 'create' | 'finish' | null {
  // An unfinished suspension (or lifting of one) comes first, as on the server.
  if (!account.suspension_settled && EXISTS_IN_GOOGLE.has(account.status)) {
    return 'suspension';
  }
  if (account.status === GoogleAccountStatus.PENDING || account.status === GoogleAccountStatus.FAILED) {
    return 'create';
  }
  if (
    account.status === GoogleAccountStatus.CREATED &&
    (!account.credentials_sent || account.pending_groups.length > 0 || account.license_pending)
  ) {
    return 'finish';
  }
  return null;
}
