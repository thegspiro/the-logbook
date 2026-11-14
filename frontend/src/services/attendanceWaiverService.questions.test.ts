import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();
vi.mock('./apiClient', () => ({
  default: { post: (...args: unknown[]) => mockPost(...args) as unknown },
}));

import { attendanceWaiverService } from './attendanceWaiverService';

describe('attendanceWaiverService questions and answers', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { id: 'req/1' } });
  });

  it('posts a decider’s question to request-info', async () => {
    await expect(attendanceWaiverService.requestInfo('req/1', 'Which shift?')).resolves.toMatchObject({
      id: 'req/1',
      actions: [],
    });
    expect(mockPost).toHaveBeenCalledWith('/training/waivers/requests/req%2F1/request-info', {
      note: 'Which shift?',
    });
  });

  it('posts the member’s answer to respond', async () => {
    await expect(attendanceWaiverService.respond('req/1', 'B shift')).resolves.toMatchObject({ actions: [] });
    expect(mockPost).toHaveBeenCalledWith('/training/waivers/requests/req%2F1/respond', { note: 'B shift' });
  });
});
