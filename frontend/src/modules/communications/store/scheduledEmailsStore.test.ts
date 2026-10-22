import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCancel = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../../services/api', () => ({
  scheduledEmailsService: {
    list: vi.fn(),
    create: vi.fn(),
    cancel: (...args: unknown[]) => mockCancel(...args) as unknown,
    update: (...args: unknown[]) => mockUpdate(...args) as unknown,
  },
}));

import { useScheduledEmailsStore } from './scheduledEmailsStore';
import type { ScheduledEmail } from '../../../services/api';

const pending: ScheduledEmail = {
  id: 'se1',
  organization_id: 'org-1',
  template_type: 'custom',
  to_emails: ['member@example.test'],
  scheduled_at: '2026-11-01T12:00:00Z',
  status: 'pending',
  created_at: '2026-10-01T12:00:00Z',
} as ScheduledEmail;

/** An axios-shaped refusal whose own message is only the status line. */
const refusal = (detail: string) =>
  Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { detail }, status: 400 },
  });

describe('scheduledEmailsStore cancelScheduledEmail', () => {
  beforeEach(() => {
    useScheduledEmailsStore.setState({ scheduledEmails: [pending], isLoading: false, isSaving: false, error: null });
    mockCancel.mockReset();
    mockUpdate.mockReset();
  });

  it('marks the email cancelled rather than removing it', async () => {
    mockCancel.mockResolvedValue(undefined);

    await useScheduledEmailsStore.getState().cancelScheduledEmail('se1');

    const state = useScheduledEmailsStore.getState();
    expect(mockCancel).toHaveBeenCalledWith('se1');
    expect(state.scheduledEmails.map((e) => [e.id, e.status])).toEqual([['se1', 'cancelled']]);
    expect(state.isSaving).toBe(false);
  });

  it("rethrows the server's reason and leaves the email pending", async () => {
    mockCancel.mockRejectedValue(refusal('This email has already been sent and cannot be cancelled'));

    await expect(useScheduledEmailsStore.getState().cancelScheduledEmail('se1')).rejects.toThrow(
      'This email has already been sent and cannot be cancelled'
    );

    const state = useScheduledEmailsStore.getState();
    expect(state.error).toBe('This email has already been sent and cannot be cancelled');
    expect(state.scheduledEmails.map((e) => e.status)).toEqual(['pending']);
    expect(state.isSaving).toBe(false);
  });
});
