/**
 * Behavioral test for `adminHoursEntryService.exportCsv` (AH-21, pass 2 tend).
 *
 * `moduleFetchIntegrity.test.ts` only scans source text for a reintroduced
 * `fetch(`/`axios` bypass — it would pass even if `exportCsv` stopped calling
 * the shared client correctly (wrong URL, wrong config, or a failure
 * silently swallowed instead of propagated). This exercises the real
 * function and asserts what it actually sends and does with a failure,
 * mocking only `createApiClient` (the module's one HTTP dependency) so the
 * client the test doubles for the module's own request never touches a raw
 * `fetch()` or `XMLHttpRequest`. `createApiClient.test.ts` separately proves
 * the real interceptor chain (401 refresh, blob-error-body decoding) that
 * this mock stands in for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn<(url: string, config: Record<string, unknown>) => Promise<{ data: unknown }>>();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

// Import AFTER the mock is in place.
import { adminHoursEntryService } from './api';

describe('adminHoursEntryService.exportCsv', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('requests the export through the shared api client as a blob with no client-side timeout', async () => {
    const blob = new Blob(['member,category,hours'], { type: 'text/csv' });
    mockGet.mockResolvedValue({ data: blob });

    const result = await adminHoursEntryService.exportCsv({ status: 'approved', categoryId: 'cat-1' });

    expect(result).toBe(blob);
    expect(mockGet).toHaveBeenCalledTimes(1);
    const [url, config] = mockGet.mock.calls[0] ?? [];
    expect(url).toBe('/admin-hours/entries/export');
    expect(config?.params).toMatchObject({ status: 'approved', category_id: 'cat-1' });
    expect(config?.responseType).toBe('blob');
    // No finite timeout: an unbounded org-scoped export can legitimately run
    // longer than the app's standard request timeout (AH21-1).
    expect(config?.timeout).toBe(0);
  });

  it('propagates a failure from the shared client rather than swallowing it', async () => {
    const failure = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401, data: { detail: 'Session expired' } },
    });
    mockGet.mockRejectedValue(failure);

    await expect(adminHoursEntryService.exportCsv()).rejects.toBe(failure);
  });
});
