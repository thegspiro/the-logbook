/**
 * What the Convert dialog sends.
 *
 * The dialog collects "Notes (optional)" and handed them to `convertToMember`,
 * which built its payload by hand and left them out -- the coordinator's
 * notes were discarded without a word. They now travel with the transfer and
 * land in the applicant's activity log.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPost = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  }),
}));

// Import AFTER the mock is in place.
import { applicantService } from './api';

type ConvertData = Parameters<typeof applicantService.convertToMember>[1];

const base: ConvertData = {
  target_membership_type: 'regular',
  member_class: 'operational',
  member_status: 'probationary',
  send_welcome_email: false,
};

const sent = async (data: ConvertData) => {
  await applicantService.convertToMember('prospect-1', data);
  return mockPost.mock.calls[0]?.[1] as Record<string, unknown>;
};

describe('applicantService.convertToMember', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { user_id: 'u-1' } });
  });

  it('sends the notes the coordinator wrote', async () => {
    const payload = await sent({ ...base, notes: '  Cleared by the chief on 9/28.  ' });

    expect(mockPost.mock.calls[0]?.[0]).toBe('/prospective-members/prospects/prospect-1/transfer');
    expect(payload.notes).toBe('Cleared by the chief on 9/28.');
  });

  it('omits blank notes rather than sending an empty string', async () => {
    const payload = await sent({ ...base, notes: '   ' });

    expect(payload).not.toHaveProperty('notes');
  });
});
