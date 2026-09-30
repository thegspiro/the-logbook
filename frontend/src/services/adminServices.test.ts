/**
 * memberStatusService list methods read every page.
 *
 * The leave and training-waiver endpoints page with skip/limit and default to
 * 100 rows. The waiver screen matches each leave to the training waiver it
 * created, so a truncated list made linked waivers look standalone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));

import { LIST_ALL_PAGE_SIZE, memberStatusService } from './adminServices';

const rows = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` }));

describe.each([
  ['listLeavesOfAbsence', '/users/leaves-of-absence'],
  ['listTrainingWaivers', '/training/waivers'],
] as const)('memberStatusService.%s', (method, url) => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({ data: [] });
  });

  it('requests further pages until a short page, and concatenates them', async () => {
    mockGet
      .mockResolvedValueOnce({ data: rows('a', LIST_ALL_PAGE_SIZE) })
      .mockResolvedValueOnce({ data: rows('b', LIST_ALL_PAGE_SIZE) })
      .mockResolvedValueOnce({ data: rows('c', 3) });

    const result = await memberStatusService[method]({ active_only: false });

    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(mockGet.mock.calls.map((c) => c[0] as string)).toEqual([url, url, url]);
    expect(mockGet.mock.calls.map((c) => (c[1] as { params: unknown }).params)).toEqual([
      { active_only: false, skip: 0, limit: LIST_ALL_PAGE_SIZE },
      { active_only: false, skip: LIST_ALL_PAGE_SIZE, limit: LIST_ALL_PAGE_SIZE },
      { active_only: false, skip: 2 * LIST_ALL_PAGE_SIZE, limit: LIST_ALL_PAGE_SIZE },
    ]);
    expect(result).toHaveLength(2 * LIST_ALL_PAGE_SIZE + 3);
    expect(result[0]).toEqual({ id: 'a-0' });
    expect(result[LIST_ALL_PAGE_SIZE]).toEqual({ id: 'b-0' });
    expect(result[result.length - 1]).toEqual({ id: 'c-2' });
  });

  it('stops after one request when the first page is short', async () => {
    mockGet.mockResolvedValueOnce({ data: rows('a', 2) });

    const result = await memberStatusService[method]({ user_id: 'u1' });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(url, { params: { user_id: 'u1', skip: 0, limit: LIST_ALL_PAGE_SIZE } });
    expect(result).toHaveLength(2);
  });

  it('asks for the next page after an exactly full one, and stops on the empty page', async () => {
    mockGet.mockResolvedValueOnce({ data: rows('a', LIST_ALL_PAGE_SIZE) }).mockResolvedValueOnce({ data: [] });

    const result = await memberStatusService[method]();

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(LIST_ALL_PAGE_SIZE);
  });

  it('treats a non-array body as an empty page rather than looping', async () => {
    mockGet.mockResolvedValueOnce({ data: '<html>captive portal</html>' });

    await expect(memberStatusService[method]()).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
