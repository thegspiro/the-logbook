import { describe, it, expect, vi, afterEach } from 'vitest';
import { AxiosError } from 'axios';
import { isStepUpRequired, registerStepUpRequester, requestStepUp } from './stepUp';

function axiosError(status: number, data: unknown): AxiosError {
  const error = new AxiosError('failed');
  error.response = { status, data, statusText: '', headers: {}, config: {} as never };
  return error;
}

afterEach(() => {
  registerStepUpRequester(null);
});

describe('isStepUpRequired', () => {
  it('is true for a 403 carrying the step-up code', () => {
    expect(isStepUpRequired(axiosError(403, { code: 'LB-AUTH-013' }))).toBe(true);
  });

  it('is false for any other 403, other status, or non-axios error', () => {
    expect(isStepUpRequired(axiosError(403, { code: 'LB-PERM-001' }))).toBe(false);
    expect(isStepUpRequired(axiosError(401, { code: 'LB-AUTH-013' }))).toBe(false);
    expect(isStepUpRequired(axiosError(403, 'nope'))).toBe(false);
    expect(isStepUpRequired(new Error('x'))).toBe(false);
  });
});

describe('requestStepUp', () => {
  it('resolves false when no prompt is registered', async () => {
    await expect(requestStepUp()).resolves.toBe(false);
  });

  it('can be asked again after the previous prompt settles', async () => {
    const requester = vi.fn(() => Promise.resolve(true));
    registerStepUpRequester(requester);

    await requestStepUp();
    await requestStepUp();

    expect(requester).toHaveBeenCalledTimes(2);
  });
});
