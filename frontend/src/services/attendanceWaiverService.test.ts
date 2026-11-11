import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
vi.mock('./apiClient', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) as unknown },
}));

import { attendanceWaiverService } from './attendanceWaiverService';

// A body that is not the declared shape (the e2e catch-all `{}`, a captive
// portal's HTML) must reach a screen as empty lists, not as a crash on .map.
describe('attendanceWaiverService response shapes', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('turns a non-array /mine body into an empty list', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(attendanceWaiverService.listMine()).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledWith('/training/waivers/requests/mine');
  });

  it('gives a malformed page empty items and a zero total', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(attendanceWaiverService.list({ status: 'pending', limit: 1 })).resolves.toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('gives a request with no decision log an empty one', async () => {
    mockGet.mockResolvedValue({ data: { id: 'req-1' } });
    await expect(attendanceWaiverService.get('req-1')).resolves.toEqual({
      id: 'req-1',
      actions: [],
      attachments: [],
      can_attach: false,
    });
  });

  it('gives a policy and an eligibility answer with no lists empty ones', async () => {
    mockGet.mockResolvedValue({ data: {} });
    await expect(attendanceWaiverService.getPolicy()).resolves.toEqual({
      categories: [],
      approver_position_ids: [],
      attachment: 'off',
      attachment_retention_days: 365,
    });
    await expect(attendanceWaiverService.getEligibility('evt-1')).resolves.toEqual({
      categories: [],
      attachment: 'off',
    });
    expect(mockGet).toHaveBeenLastCalledWith('/training/waivers/requests/eligibility', {
      params: { event_id: 'evt-1' },
    });
  });

  it('keeps every request path under the uncacheable /training/waivers prefix', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await attendanceWaiverService.listMine();
    expect(String(mockGet.mock.calls[0]?.[0])).toMatch(/^\/training\/waivers\//);
  });
});
