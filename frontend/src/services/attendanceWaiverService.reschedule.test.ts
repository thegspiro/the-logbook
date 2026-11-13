import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
vi.mock('./apiClient', () => ({
  default: { post: (...args: unknown[]) => mockPost(...args) as unknown },
}));

import { attendanceWaiverService } from './attendanceWaiverService';

describe('attendanceWaiverService.confirm', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('posts to the request’s confirm route and normalizes the answer', async () => {
    mockPost.mockResolvedValue({ data: { id: 'req/1' } });
    await expect(attendanceWaiverService.confirm('req/1')).resolves.toEqual({
      id: 'req/1',
      actions: [],
      attachments: [],
      can_attach: false,
    });
    expect(mockPost).toHaveBeenCalledWith('/training/waivers/requests/req%2F1/confirm');
  });
});
