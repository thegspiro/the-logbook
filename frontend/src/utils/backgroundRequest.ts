import type { AxiosRequestConfig } from 'axios';

/**
 * Request config for a poll nobody asked for.
 *
 * The server ends a session after a stretch with no activity and counts every
 * authenticated request as activity. A poll that fires every minute therefore
 * kept any open tab alive indefinitely and made the server's timer meaningless.
 * This header tells the server a request is not evidence a person is present.
 *
 * It can only ever make the caller's own session age faster, so a client that
 * omits or forges it gains nothing. Real input is reported separately by the
 * heartbeat in `useIdleTimer`.
 *
 * Pass it as the last argument of a service call that a timer, not a person,
 * triggered. Never on a request a person's action caused.
 */
export const BACKGROUND_REQUEST_CONFIG: AxiosRequestConfig = {
  headers: { 'X-Background-Request': '1' },
};
