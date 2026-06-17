import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import type { InboxMessage } from '../../../services/adminServices';

const mockGetInbox = vi.fn();
const mockMarkAsRead = vi.fn();
const mockAcknowledge = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    getInbox: (...args: unknown[]) => mockGetInbox(...args) as unknown,
    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args) as unknown,
    acknowledge: (...args: unknown[]) => mockAcknowledge(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MessagesInboxPage from './MessagesInboxPage';

const msg = (overrides: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1',
  title: 'Mandatory training',
  body: 'Please complete by Friday.',
  priority: 'important',
  target_type: 'all',
  is_pinned: false,
  is_persistent: false,
  requires_acknowledgment: true,
  is_read: false,
  is_acknowledged: false,
  ...overrides,
});

const renderPage = () =>
  render(
    <BrowserRouter>
      <MessagesInboxPage />
    </BrowserRouter>
  );

describe('MessagesInboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkAsRead.mockResolvedValue(undefined);
    mockAcknowledge.mockResolvedValue(undefined);
  });

  it('marks a message read the first time its body is expanded', async () => {
    const user = userEvent.setup();
    mockGetInbox.mockResolvedValue([msg({ requires_acknowledgment: false })]);
    renderPage();

    const titleButton = await screen.findByRole('button', { name: /Mandatory training/i });
    await user.click(titleButton);

    await waitFor(() => expect(mockMarkAsRead).toHaveBeenCalledWith('m1'));
  });

  it('acknowledges a message that requires it', async () => {
    const user = userEvent.setup();
    mockGetInbox.mockResolvedValue([msg()]);
    renderPage();

    const titleButton = await screen.findByRole('button', { name: /Mandatory training/i });
    await user.click(titleButton);

    const ackButton = await screen.findByRole('button', { name: /acknowledge/i });
    await user.click(ackButton);

    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith('m1'));
  });

  it('shows an empty state when there are no messages', async () => {
    mockGetInbox.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No messages/i)).toBeInTheDocument();
  });
});
