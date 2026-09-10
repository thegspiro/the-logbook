/**
 * The two ways this service reads the rank ladder, and why there are two.
 *
 * `getRanks` funnels the body through `asArray`, which turns a non-array into
 * `[]`. That is deliberate and right for the surfaces that only *display*
 * ranks: a captive portal or proxy answers HTTP 200 with an HTML body, and a
 * dropdown rendering nothing beats a page dying through the ErrorBoundary.
 *
 * The administration screen inverts it. There an empty list is not a degraded
 * view, it is a claim about the database — "no ranks configured" — shown to an
 * officer who can act on it. So `getRankLadder` reads the response itself.
 *
 * This is asserted at the service rather than in the component because the
 * component cannot tell the difference: a guard there sits *above* `asArray`
 * and never fires, which is precisely the bug these tests pin down.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { ranksService } from './facilitiesServices';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ranksService.getRankLadder', () => {
  it('returns the ladder when the response is a list', async () => {
    const ranks = [{ id: 'r1', rank_code: 'captain', display_name: 'Captain' }];
    mockGet.mockResolvedValueOnce({ data: ranks });

    await expect(ranksService.getRankLadder()).resolves.toEqual(ranks);
  });

  it.each([
    ['a proxy error page', '<html>502 Bad Gateway</html>'],
    ['an error object', { detail: 'Not Found' }],
    ['a null body', null],
  ])('throws rather than reporting an empty ladder for %s', async (_label, body) => {
    mockGet.mockResolvedValueOnce({ data: body });

    // The whole point: this must reject, so the screen can say the ladder could
    // not be loaded. Resolving to [] renders "no ranks configured" — a claim
    // about the department that a gateway is not entitled to make.
    await expect(ranksService.getRankLadder()).rejects.toThrow(/not an array/);
  });

  it('leaves the display read degrading to empty, as its callers expect', async () => {
    // Not a contradiction — the assertion that keeps the two apart. Changing
    // getRanks to throw would push the failure into every dropdown and roster
    // that reads it, which is the trade asArray was introduced to avoid.
    mockGet.mockResolvedValueOnce({ data: { detail: 'Not Found' } });

    await expect(ranksService.getRanks()).resolves.toEqual([]);
  });
});

describe('ranksService.getRankLadder filtering', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('passes the active filter through, so a strict read can replace a lenient one', () => {
    // `useRanks` reads strictly now, and it filters to active ranks. Without
    // this the strict reader would hand every consumer the inactive ranks too.
    mockGet.mockResolvedValue({ data: [] });

    void ranksService.getRankLadder({ is_active: true });

    expect(mockGet).toHaveBeenCalledWith('/operational-ranks', { params: { is_active: true } });
  });

  it('sends no filter when none is asked for', () => {
    mockGet.mockResolvedValue({ data: [] });

    void ranksService.getRankLadder();

    expect(mockGet).toHaveBeenCalledWith('/operational-ranks', { params: undefined });
  });
});
