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

  it('rejects the original request when session refresh fails', async () => {
    const refreshFailure = new Error('refresh failed');
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
    expect(mocks.reportApiError).toHaveBeenCalledWith(requestError);
  });
});
