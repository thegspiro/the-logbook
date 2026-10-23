/**
 * Step-up re-verification: the server answers a sensitive action with 403
 * `LB-AUTH-013` until the member has re-verified on this session. The API
 * clients call `requestStepUp()` on that answer and retry the request when it
 * resolves true; `StepUpProvider` is what shows the prompt.
 */

import axios from 'axios';

/** Mirrors ErrorCode.AUTH_STEPUP_REQUIRED in app/core/error_codes.py. */
export const STEPUP_REQUIRED_CODE = 'LB-AUTH-013';

export function isStepUpRequired(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const data: unknown = err.response?.data;
  return (
    err.response?.status === 403 &&
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: unknown }).code === STEPUP_REQUIRED_CODE
  );
}

type StepUpRequester = () => Promise<boolean>;

let requester: StepUpRequester | null = null;
let inFlight: Promise<boolean> | null = null;

/** Called by `StepUpProvider` on mount; pass null on unmount. */
export function registerStepUpRequester(fn: StepUpRequester | null): void {
  requester = fn;
}

/**
 * Ask the member to re-verify. Concurrent callers share one prompt, so three
 * requests failing at once produce one dialog. Resolves false when there is no
 * prompt to show or the member cancels.
 */
export function requestStepUp(): Promise<boolean> {
  if (!requester) return Promise.resolve(false);
  inFlight ??= requester().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
