/**
 * What a department needs to know before sending through Gmail / Google
 * Workspace with an App Password, shown on both the onboarding email step and
 * Settings → Email so the two cannot drift.
 *
 * Each line answers a way Gmail sending stops working with nothing in The
 * Logbook having changed: the account's owner leaves, its password changes
 * (Google revokes every App Password on the account when it does), or the
 * domain has no DKIM, so receiving providers file the mail as spam.
 */
export const GMAIL_SENDING_NOTES: readonly string[] = [
  "Send from a dedicated account, such as notifications@yourdepartment.org, not a member's own. A personal account stops sending when its owner leaves and the account is suspended.",
  "Changing that account's password revokes all of its App Passwords. Email stops until a new App Password is entered here, so run Test Connection after any password change.",
  'On your own domain, turn on DKIM in the Google Admin console (Apps → Google Workspace → Gmail → Authenticate email) and publish SPF and DMARC records. Without them, Gmail, Outlook and Yahoo may send department mail to spam or reject it.',
];
