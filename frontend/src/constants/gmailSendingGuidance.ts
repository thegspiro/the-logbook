/**
 * What a department needs to know before relying on Gmail / Google Workspace
 * for its email, shown on the onboarding email step and on Settings → Email so
 * the two cannot drift.
 *
 * Each line answers a way Gmail sending stops working with nothing in The
 * Logbook having changed: the account's owner leaves, its password changes
 * (Google revokes every App Password on the account when it does), or the
 * domain has no DKIM, so receiving providers file the mail as spam.
 */
const DEDICATED_ACCOUNT =
  "Send from a dedicated account, such as notifications@yourdepartment.org, not a member's own. A personal account stops sending when its owner leaves and the account is suspended.";

const PASSWORD_CHANGE_REVOKES =
  "Changing that account's password revokes all of its App Passwords. Email stops until a new App Password is entered here, so run Test Connection after any password change.";

const DKIM =
  'On your own domain, turn on DKIM in the Google Admin console (Apps → Google Workspace → Gmail → Authenticate email) and publish SPF and DMARC records. Without them, Gmail, Outlook and Yahoo may send department mail to spam or reject it.';

/** For the App Password method. */
export const GMAIL_SENDING_NOTES: readonly string[] = [DEDICATED_ACCOUNT, PASSWORD_CHANGE_REVOKES, DKIM];

/**
 * For the service-account method, which a password change does not affect —
 * that is the reason to choose it — so the revocation note is left out.
 */
export const GMAIL_SERVICE_ACCOUNT_NOTES: readonly string[] = [DEDICATED_ACCOUNT, DKIM];
