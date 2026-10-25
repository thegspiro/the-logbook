/**
 * Holds API traffic while the signed-in member must change their password.
 *
 * The server refuses every request from such a member except the few that
 * let them read their state and make the change (`get_current_user` in
 * `backend/app/api/dependencies.py`). The account screen is all they can
 * reach, but it renders inside the app shell, and the shell and the screen's
 * other sections still asked for modules, notifications, budgets, ranks and
 * more — about fifteen requests on a first sign-in, each refused with a 403,
 * and each then reported to `/errors/log`, which is refused too (W08-6).
 *
 * While the flag is set, a request outside the allowlist is answered here
 * with the same 403 the server would send, so callers behave exactly as they
 * did, nothing goes over the network, and the reporter can tell the refusal
 * is expected (it carries the server's own code).
 */

import { AxiosError } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/** The server's code for this refusal (`ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED`). */
export const PASSWORD_CHANGE_REQUIRED_CODE = 'LB-AUTH-004';

/**
 * Mirrors `_MUST_CHANGE_PW_ALLOWED_SUFFIXES` in `backend/app/api/dependencies.py`.
 * Matched the way the server matches them: by suffix, trailing slash ignored.
 * Kept as a copy because the browser cannot read the server's; if a path is
 * added there and not here, that request is held by the browser while the
 * server would have allowed it, and `passwordChangeGate.test.ts` lists both.
 */
export const PASSWORD_CHANGE_ALLOWED_SUFFIXES: readonly string[] = [
  '/auth/change-password',
  '/auth/logout',
  '/auth/me',
  '/auth/refresh',
  '/auth/session-settings',
];

let passwordChangePending = false;

/** Set by the auth store from the signed-in user's `must_change_password`. */
export function setPasswordChangePending(pending: boolean): void {
  passwordChangePending = pending;
}

export function isPasswordChangePending(): boolean {
  return passwordChangePending;
}

function requestPath(config: InternalAxiosRequestConfig): string {
  const url = config.url ?? '';
  const absolute = /^https?:\/\//i.test(url) ? new URL(url).pathname : `${config.baseURL ?? ''}${url}`;
  return (absolute.split('?')[0] ?? '').replace(/\/+$/, '');
}

export function isAllowedDuringPasswordChange(config: InternalAxiosRequestConfig): boolean {
  const path = requestPath(config);
  return PASSWORD_CHANGE_ALLOWED_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

/**
 * Request-interceptor step shared by both axios clients. Leaves the config
 * alone unless a change is pending and the path is one the server refuses,
 * in which case the request resolves to the server's 403 without being sent.
 */
export function holdDuringPasswordChange(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  if (!passwordChangePending || isAllowedDuringPasswordChange(config)) return config;

  config.adapter = () => {
    const response: AxiosResponse = {
      data: { detail: 'Password change required before continuing.', code: PASSWORD_CHANGE_REQUIRED_CODE },
      status: 403,
      statusText: 'Forbidden',
      headers: { 'x-password-change-required': 'true' },
      config,
    };
    return Promise.reject(
      new AxiosError('Request failed with status code 403', AxiosError.ERR_BAD_REQUEST, config, null, response)
    );
  };
  return config;
}

/** True for the refusal above, or the server's own, so neither is reported as a fault. */
export function isPasswordChangeRefusal(error: AxiosError): boolean {
  if (error.response?.status !== 403) return false;
  const code = (error.response.data as { code?: unknown } | undefined)?.code;
  return code === PASSWORD_CHANGE_REQUIRED_CODE;
}
