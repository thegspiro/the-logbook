import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

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

function axiosErr(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', String(status), config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { detail: 'No attendance record found' },
  } as never);
}

const record = {
  id: 'att-1',
  shift_id: 'shift-1',
  user_id: 'user-1',
  checked_in_at: '2026-11-02T13:05:00Z',
};

/**
 * `GET /scheduling/shifts/{id}/my-attendance` answers 200 with `null` for a
 * member not yet checked in. Before, it answered 404, and the browser logged a
 * failed request on every ordinary opening of the check-in page.
 */
describe('schedulingService.getMyAttendance', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('reads a null body as "not checked in"', async () => {
    mockGet.mockResolvedValueOnce({ data: null });
    await expect(schedulingService.getMyAttendance('shift-1')).resolves.toBeNull();
    expect(mockGet).toHaveBeenCalledWith('/scheduling/shifts/shift-1/my-attendance');
  });

  it('returns the record once the member has checked in', async () => {
    mockGet.mockResolvedValueOnce({ data: record });
    await expect(schedulingService.getMyAttendance('shift-1')).resolves.toEqual(record);
  });

  it('still reads an older backend\'s 404 as "not checked in"', async () => {
    mockGet.mockRejectedValueOnce(axiosErr(404));
    await expect(schedulingService.getMyAttendance('shift-1')).resolves.toBeNull();
  });

  it('does not hide any other failure', async () => {
    mockGet.mockRejectedValueOnce(axiosErr(500));
    await expect(schedulingService.getMyAttendance('shift-1')).rejects.toBeInstanceOf(AxiosError);
  });
});

/**
 * The Past view reads a member's whole attendance history. A single request
 * at the endpoint's default of 50 left a long-serving member's older shifts
 * and their hours off the screen.
 */
describe('schedulingService.getAllMyAttendanceHistory', () => {
  const page = (count: number, start: number) =>
    Array.from({ length: count }, (_, i) => ({ ...record, id: `att-${start + i}`, shift_id: `shift-${start + i}` }));

  beforeEach(() => {
    mockGet.mockReset();
  });

  it('reads page after page until one comes back short', async () => {
    mockGet
      .mockResolvedValueOnce({ data: page(200, 0) })
      .mockResolvedValueOnce({ data: page(200, 200) })
      .mockResolvedValueOnce({ data: page(37, 400) });

    const records = await schedulingService.getAllMyAttendanceHistory();

    expect(records).toHaveLength(437);
    expect(new Set(records.map((r) => r.id)).size).toBe(437);
    expect(mockGet.mock.calls.map((call) => (call[1] as { params: { offset: number } }).params.offset)).toEqual([
      0, 200, 400,
    ]);
    expect(mockGet).toHaveBeenCalledWith('/scheduling/my-attendance-history', {
      params: { limit: 200, offset: 0, start_date: undefined, end_date: undefined },
    });
  });

  it('makes one request for a member with less than a page', async () => {
    mockGet.mockResolvedValueOnce({ data: page(3, 0) });
    await expect(schedulingService.getAllMyAttendanceHistory()).resolves.toHaveLength(3);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('stops after its page limit if every page comes back full', async () => {
    mockGet.mockResolvedValue({ data: page(200, 0) });
    await schedulingService.getAllMyAttendanceHistory();
    expect(mockGet).toHaveBeenCalledTimes(100);
  });
});
