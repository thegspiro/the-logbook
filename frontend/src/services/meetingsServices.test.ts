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
const mockPost = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
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
    ['a JSON null body', null],
    ['an empty object', {}],
    ['a non-array meetings field', { meetings: null, total: 0 }],
    ['an HTML page', '<!doctype html><title>Sign in to Station Wi-Fi</title>'],
  ])('returns an empty meetings array for %s', async (_label, data) => {
    mockGet.mockResolvedValue({ data });

    const result = await meetingsService.getMeetings();

    expect(result.meetings).toEqual([]);
  });
});

/**
 * D7: the waiver reason may be medical. It travels in the JSON body the
 * endpoint reads, never as query parameters, which land in access logs and
 * URL history.
 */
describe('meetingsService.grantAttendanceWaiver', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { attendee_id: 'a1' } });
  });

  it('sends the member and the reason as a JSON body, with no query string', async () => {
    await meetingsService.grantAttendanceWaiver('m1', { user_id: 'u1', reason: 'Hospital stay' });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const call: unknown[] = (mockPost.mock.calls[0] as unknown[] | undefined) ?? [];
    const [url, body, config] = call;
    expect(url).toBe('/meetings/m1/attendance-waiver');
    expect(String(url)).not.toContain('Hospital');
    expect(body).toEqual({ user_id: 'u1', reason: 'Hospital stay' });
    expect(config).toBeUndefined();
  });
});
