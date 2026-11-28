/**
 * MSG2-7: every edit re-sent the stored expiry, and the server validates the
 * expiry whenever the key is present — so a published message past its
 * expiry could not be edited at all, not even to fix a typo ("The expiry time
 * must be in the future"). An edit now sends the expiry and schedule only when
 * they were changed; clearing one still sends null.
 *
 * MSG2-8: the edit form offered "Schedule for later" on a message already
 * published, which the server refuses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    createMessage: vi.fn(),
    updateMessage: (...args: unknown[]) => mockUpdate(...args) as unknown,
    getAvailableRoles: () => Promise.resolve([]),
  },
  userService: { getUsers: () => Promise.resolve([]) },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import MessageComposeForm from './MessageComposeForm';

const published = {
  id: 'm1',
  organization_id: 'org1',
  title: 'Hydrant flushing Tuesday',
  body: 'Expect low pressure on Main St.',
  priority: 'normal' as const,
  target_type: 'all' as const,
  is_pinned: false,
  is_active: true,
  is_persistent: false,
  requires_acknowledgment: false,
  expires_at: '2026-11-01T12:00:00Z',
  scheduled_at: null,
};

describe('MessageComposeForm editing a published message', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({ id: 'm1' });
  });

  it('saves a typo fix on an expired message without re-sending its expiry', async () => {
    const user = userEvent.setup();
    render(<MessageComposeForm message={published as never} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Title/), '!');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.title).toBe('Hydrant flushing Tuesday!');
    expect(payload).not.toHaveProperty('expires_at');
    expect(payload).not.toHaveProperty('scheduled_at');
  });

  it('still clears an expiry the officer removed', async () => {
    const user = userEvent.setup();
    render(<MessageComposeForm message={published as never} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.clear(screen.getByLabelText(/^Expires/));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdate.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.expires_at).toBeNull();
  });

  it('does not offer to schedule a message already published', async () => {
    render(<MessageComposeForm message={published as never} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByLabelText(/^Schedule for later/)).not.toBeInTheDocument();
  });
});
