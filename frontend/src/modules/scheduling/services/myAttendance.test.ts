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
