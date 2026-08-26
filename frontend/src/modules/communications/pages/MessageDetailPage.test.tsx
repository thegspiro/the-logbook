import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import type { InboxMessage } from '../../../services/adminServices';

const mockGetInboxMessage = vi.fn();
const mockMarkAsRead = vi.fn();
const mockAcknowledge = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    getInboxMessage: (...args: unknown[]) => mockGetInboxMessage(...args) as unknown,
    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args) as unknown,
    acknowledge: (...args: unknown[]) => mockAcknowledge(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import MessageDetailPage from './MessageDetailPage';

const msg = (overrides: Partial<InboxMessage> = {}): InboxMessage => ({
  id: 'm1',
  title: 'New Building Code',
  body: 'Effective September 1.',
  priority: 'important',
  target_type: 'all',
  is_pinned: true,
  is_persistent: false,
  requires_acknowledgment: true,
  author_name: 'Shelly Hernandez',
  is_read: false,
  is_acknowledged: false,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/messages/m1']}>
      <Routes>
        <Route path="/messages/:messageId" element={<MessageDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('MessageDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkAsRead.mockResolvedValue(undefined);
    mockAcknowledge.mockResolvedValue(undefined);
  });

  it('offers a path back to the full inbox', async () => {
    mockGetInboxMessage.mockResolvedValue(msg());
    renderPage();

    await screen.findByRole('heading', { name: /New Building Code/i });
    // The breadcrumb crumb and the explicit back link both point at the inbox.
    const backLinks = screen.getAllByRole('link', { name: /messages/i });
    expect(backLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of backLinks) {
      expect(link).toHaveAttribute('href', '/messages');
    }
  });

  it('loads the message by the id in the URL and marks it read', async () => {
    mockGetInboxMessage.mockResolvedValue(msg());
    renderPage();

    await waitFor(() => expect(mockGetInboxMessage).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(mockMarkAsRead).toHaveBeenCalledWith('m1'));
  });

  it('does not re-send a read receipt for an already read message', async () => {
    mockGetInboxMessage.mockResolvedValue(msg({ is_read: true }));
    renderPage();

    await screen.findByRole('heading', { name: /New Building Code/i });
    expect(mockMarkAsRead).not.toHaveBeenCalled();
  });

  it('acknowledges a message that requires it', async () => {
    const user = userEvent.setup();
    mockGetInboxMessage.mockResolvedValue(msg());
    renderPage();

    const ackButton = await screen.findByRole('button', { name: /acknowledge/i });
    await user.click(ackButton);

    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText(/^Acknowledged/)).toBeInTheDocument();
  });

  it('keeps a route back to the inbox when the message cannot be loaded', async () => {
    mockGetInboxMessage.mockRejectedValue(new Error('Not found'));
    renderPage();

    expect(await screen.findByText(/Message unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Messages$/i })).toHaveAttribute('href', '/messages');
  });
});
