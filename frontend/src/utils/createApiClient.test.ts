import type { AxiosError, AxiosInstance } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  responseUse: vi.fn(),
  requestUse: vi.fn(),
  refresh: vi.fn(),
  expireSession: vi.fn(),
  reportApiError: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => {
      const client = vi.fn() as unknown as AxiosInstance;
      client.interceptors = {
        request: { use: mocks.requestUse } as AxiosInstance['interceptors']['request'],
        response: { use: mocks.responseUse } as AxiosInstance['interceptors']['response'],
      };
      return client;
    }),
    isAxiosError: (value: unknown): boolean => (value as AxiosError | null)?.isAxiosError === true,
  },
}));

vi.mock('../services/apiClient', () => ({
  performSharedRefresh: mocks.refresh,
  handleExpiredSession: mocks.expireSession,
}));

vi.mock('../services/errorReporting', () => ({
  reportApiError: mocks.reportApiError,
}));

import { createApiClient } from './createApiClient';

describe('createApiClient response interceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects the original request and reports the refresh failure when session refresh fails', async () => {
    // The refresh endpoint failing with a 503 is exactly the outage the
    // report exists to record — the reporter filters out the original 401
    // as routine session expiry, so the refresh error must be what's sent.
    const refreshFailure = Object.assign(new Error('refresh unavailable'), {
      config: { url: '/auth/refresh', headers: {} },
      response: { status: 503 },
      isAxiosError: true,
    }) as AxiosError;
    mocks.refresh.mockRejectedValueOnce(refreshFailure);
    createApiClient();

    const rejectionHandler = mocks.responseUse.mock.calls[0]?.[1] as
      ((error: AxiosError) => Promise<unknown>) | undefined;
    expect(rejectionHandler).toBeTypeOf('function');

    const requestError = Object.assign(new Error('unauthorized'), {
      config: { url: '/inventory', headers: {} },
      response: { status: 401 },
      isAxiosError: true,
    }) as AxiosError;

    await expect(rejectionHandler?.(requestError)).rejects.toBe(requestError);
    expect(mocks.expireSession).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.reportApiError).toHaveBeenCalledTimes(1);
    expect(mocks.reportApiError).toHaveBeenCalledWith(refreshFailure);
    expect(mocks.reportApiError).not.toHaveBeenCalledWith(requestError);
  });
});
