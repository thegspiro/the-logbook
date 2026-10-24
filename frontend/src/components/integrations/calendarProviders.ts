/**
 * The two calendar-publishing providers, as CalendarPublishPanel and
 * IntegrationsPage need them.
 *
 * Both connect the same way: the card's button POSTs to the provider's
 * `/oauth/start`, the browser goes to the provider's sign-in, and the
 * backend callback returns to /integrations with `?<queryKey>=connected` or
 * `?<queryKey>_error=<code>`.
 */

import { integrationsService } from '../../services/api';

export interface CalendarProvider {
  integrationType: string;
  /** The card's name, e.g. "Google Calendar". */
  name: string;
  /** Who the administrator signs in with, e.g. "Google". */
  signInWith: string;
  /** Query parameter the callback sets on its way back to /integrations. */
  queryKey: string;
  intro: string;
  disconnectMessage: string;
  start: () => Promise<string>;
  /** Failure codes whose wording differs from the shared one. */
  errors: Record<string, string>;
}

export const CALENDAR_PROVIDERS: readonly CalendarProvider[] = [
  {
    integrationType: 'google-calendar',
    name: 'Google Calendar',
    signInWith: 'Google',
    queryKey: 'google_calendar',
    intro:
      'Sign in with the Google account that should own the department calendar. The Logbook creates a new calendar there and can reach only the calendars it creates.',
    disconnectMessage:
      'Events stop being published and The Logbook gives up its access to the Google account. The calendar itself stays in Google with the events already on it — delete it there if the department no longer wants it. Connecting again creates a new calendar.',
    start: () => integrationsService.startGoogleCalendarConnect(),
    errors: {
      missing_client_credentials: 'No Google OAuth client is configured.',
      token_exchange_failed: 'Google did not accept the sign-in. Check the OAuth client and try again.',
      no_refresh_token: 'Google did not grant offline access. Try connecting again.',
      calendar_scope_not_granted: 'The calendar permission was not granted on the consent screen.',
    },
  },
  {
    integrationType: 'outlook',
    name: 'Microsoft Outlook',
    signInWith: 'Microsoft',
    queryKey: 'outlook_calendar',
    intro:
      'Sign in with the Microsoft 365 account that should own the department calendar; it needs an Exchange Online mailbox. The Logbook creates a new calendar there and publishes only to that one.',
    // Microsoft offers apps no way to revoke one sign-in, so this says what
    // actually happens rather than promising the access is handed back.
    disconnectMessage:
      'Events stop being published and The Logbook forgets its sign-in. Microsoft has no way for an app to hand the access back, so to end it at once remove The Logbook under My Apps in the Microsoft account. The calendar stays in Outlook with the events already on it — delete it there if the department no longer wants it. Connecting again creates a new calendar.',
    start: () => integrationsService.startOutlookCalendarConnect(),
    errors: {
      missing_client_credentials: 'No Microsoft app is configured.',
      token_exchange_failed: 'Microsoft did not accept the sign-in. Check the app registration and try again.',
      no_refresh_token: 'Microsoft did not grant offline access. Try connecting again.',
      calendar_scope_not_granted: 'The Calendars.ReadWrite permission was not granted.',
    },
  },
];

export const calendarProviderFor = (integrationType: string): CalendarProvider | undefined =>
  CALENDAR_PROVIDERS.find((p) => p.integrationType === integrationType);

// What each connect failure code means to the person who just came back from
// the provider's sign-in.
export const calendarConnectError = (provider: CalendarProvider, code: string): string => {
  const shared: Record<string, string> = {
    access_denied: `${provider.signInWith} sign-in was cancelled.`,
    invalid_state: 'The sign-in link was already used or came from another browser. Start again.',
    expired_state: 'The sign-in took longer than ten minutes. Start again.',
    integration_not_found: `${provider.name} is not set up for this department.`,
    unavailable: 'Calendar publishing is turned off on this server.',
    not_authorized: 'You no longer have permission to manage integrations.',
    calendar_create_failed: 'Signed in, but the department calendar could not be created.',
  };
  return provider.errors[code] ?? shared[code] ?? 'Something went wrong; try again.';
};
