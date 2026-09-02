import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import type { InboxMessage } from '../../../services/adminServices';

const mockGetInbox = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    getInbox: (...args: unknown[]) => mockGetInbox(...args) as unknown,
  },
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
  });

  it('links each message to its own route so the detail view can lead back here', async () => {
    mockGetInbox.mockResolvedValue([msg()]);
    renderPage();

    const link = await screen.findByRole('link', { name: /Mandatory training/i });
    expect(link).toHaveAttribute('href', '/messages/m1');
  });

  it('flags a message still awaiting acknowledgement', async () => {
    mockGetInbox.mockResolvedValue([msg()]);
    renderPage();

    expect(await screen.findByText(/Action needed/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no messages', async () => {
    mockGetInbox.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No messages/i)).toBeInTheDocument();
  });

  it('loads another page so older communications remain reachable', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => msg({ id: `m${index}`, title: `Message ${index}` }));
    mockGetInbox.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([msg({ id: 'm20', title: 'Older message' })]);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Load more messages/i }));

    expect(await screen.findByText('Older message')).toBeInTheDocument();
    expect(mockGetInbox).toHaveBeenLastCalledWith({ include_read: true, skip: 20, limit: 20 });
    expect(screen.queryByRole('button', { name: /Load more messages/i })).not.toBeInTheDocument();
  });
});
