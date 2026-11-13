import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  },
}));

import { attendanceWaiverService, meetingWaiverService } from './attendanceWaiverService';

describe('meetingWaiverService', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGet.mockResolvedValue({ data: {} });
    mockPost.mockResolvedValue({ data: { id: 'req-1' } });
  });

  it('calls the business-meeting API, not the training one', async () => {
    await meetingWaiverService.listMine();
    await meetingWaiverService.getEligibility('evt-1');
    await meetingWaiverService.respond('req-1', 'Yes');
    expect(mockGet).toHaveBeenCalledWith('/meetings/waiver-requests/mine');
    expect(mockGet).toHaveBeenCalledWith('/meetings/waiver-requests/eligibility', { params: { event_id: 'evt-1' } });
    expect(mockPost).toHaveBeenCalledWith('/meetings/waiver-requests/req-1/respond', { note: 'Yes' });
  });

  it('reads the positions from its own policy route', async () => {
    mockGet.mockResolvedValue({ data: { positions: [{ id: 'p1', name: 'Secretary' }] } });
    await expect(meetingWaiverService.getPositions()).resolves.toEqual([{ id: 'p1', name: 'Secretary' }]);
    expect(mockGet).toHaveBeenCalledWith('/meetings/waiver-requests/policy/positions');
    mockGet.mockResolvedValue({ data: {} });
    await expect(attendanceWaiverService.getPositions()).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledWith('/training/waivers/requests/policy/positions');
  });

  it('refuses documents rather than post a meeting request to the training routes', async () => {
    const file = new File(['x'], 'note.pdf', { type: 'application/pdf' });
    await expect(meetingWaiverService.submitWithAttachments({ event_id: 'evt-1' }, [file])).rejects.toThrow(
      'Documents cannot be filed with this request.'
    );
    await expect(meetingWaiverService.addAttachments('req-1', [file])).rejects.toThrow(
      'Documents cannot be filed with this request.'
    );
    expect(mockPost).not.toHaveBeenCalled();
  });
});
