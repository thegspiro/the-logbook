/**
 * meetingsService.getMeetings guarantees its `meetings` array.
 *
 * Four screens read `.meetings` straight off the response and call `.length`,
 * `.find` or `.map` on it. The election detail page did so on a list it only
 * offers as a convenience, so a body without the array — a captive portal's
 * HTML, an empty object — took the whole election down through the
 * ErrorBoundary instead of leaving the meeting picker empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
  },
}));

import { meetingsService } from './meetingsServices';

describe('meetingsService.getMeetings', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('passes the meetings through when the body carries them', async () => {
    const meetings = [{ id: 'm1' }, { id: 'm2' }];
    mockGet.mockResolvedValue({ data: { meetings, total: 2, skip: 0, limit: 100 } });

    const result = await meetingsService.getMeetings({ limit: 100 });

    expect(result.meetings).toEqual(meetings);
    expect(result.total).toBe(2);
    expect(mockGet).toHaveBeenCalledWith('/meetings', { params: { limit: 100 } });
  });

  it.each([
    ['an empty object', {}],
    ['a non-array meetings field', { meetings: null, total: 0 }],
    ['an HTML page', '<!doctype html><title>Sign in to Station Wi-Fi</title>'],
  ])('returns an empty meetings array for %s', async (_label, data) => {
    mockGet.mockResolvedValue({ data });

    const result = await meetingsService.getMeetings();

    expect(result.meetings).toEqual([]);
  });
});
