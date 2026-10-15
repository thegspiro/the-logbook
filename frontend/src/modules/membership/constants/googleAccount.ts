/**
 * Google Workspace account helpers for the member profile.
 */

import { GoogleAccountStatus } from '../../../constants/enums';
import type { GoogleAccount } from '../types/googleAccount';

export const GOOGLE_WORKSPACE_INTEGRATION = 'google-workspace';

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
    (!account.credentials_sent || account.pending_groups.length > 0)
  ) {
    return 'finish';
  }
  return null;
}
