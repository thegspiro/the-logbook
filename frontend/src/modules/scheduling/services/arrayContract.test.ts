import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }),
}));

import { schedulingService } from './api';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * These methods declare `Promise<T[]>`, but `api.get<T[]>` only asserts the
 * wire format — it does not verify it. Callers spread, `.map` and `.filter`
 * the result without checking, so a non-array body used to take a whole page
 * down through the error boundary. The contract is now enforced at the
 * boundary; these lock that in.
 */
describe('schedulingService array contract', () => {
  const bodies: Array<[string, unknown]> = [
    ['an object envelope', { shifts: [], total: 0 }],
    ['null', null],
    ['undefined', undefined],
    ['an error payload served with 200', { detail: 'Not found' }],
    ['a bare string', 'unexpected'],
  ];

  describe.each(bodies)('when the response body is %s', (_label, body) => {
    it('getMonthCalendar still returns an array', async () => {
      mockGet.mockResolvedValueOnce({ data: body });
      await expect(schedulingService.getMonthCalendar(2026, 8)).resolves.toEqual([]);
    });

    it('getWeekCalendar still returns an array', async () => {
      mockGet.mockResolvedValueOnce({ data: body });
      await expect(schedulingService.getWeekCalendar('2026-08-02')).resolves.toEqual([]);
    });

    it('getTemplates still returns an array', async () => {
      mockGet.mockResolvedValueOnce({ data: body });
      await expect(schedulingService.getTemplates()).resolves.toEqual([]);
    });

    it('getBasicApparatus still returns an array', async () => {
      mockGet.mockResolvedValueOnce({ data: body });
      await expect(schedulingService.getBasicApparatus()).resolves.toEqual([]);
    });
  });

  it('passes a well-formed array straight through', async () => {
    const shifts = [{ id: 's1' }, { id: 's2' }];
    mockGet.mockResolvedValueOnce({ data: shifts });
    await expect(schedulingService.getWeekCalendar('2026-08-02')).resolves.toEqual(shifts);
  });

  it('normalizes the assignment list before mapping over it', async () => {
    // getShiftAssignments maps each entry, so a non-array body previously threw
    // rather than yielding an empty list.
    mockGet.mockResolvedValueOnce({ data: { detail: 'boom' } });
    await expect(schedulingService.getShiftAssignments('shift-1')).resolves.toEqual([]);
  });

  it('normalizes a missing unavailable_user_ids field', async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    await expect(schedulingService.getUnavailableMembers('shift-1')).resolves.toEqual([]);
  });
});
