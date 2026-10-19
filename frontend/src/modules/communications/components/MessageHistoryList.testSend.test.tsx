/**
 * Workflow review W57: with email switched off the server refuses a test
 * send and says why, but the screen replaced that with "Failed to send test
 * email" — leaving the admin to guess at the one thing the button tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockApiError } from '../../../test/utils';

const { mockList, mockSendTestEmail, mockToastError } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockSendTestEmail: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock('../../../services/api', () => ({
  messageHistoryService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    sendTestEmail: (...args: unknown[]) => mockSendTestEmail(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

import MessageHistoryList from './MessageHistoryList';

const NOT_SET_UP =
  'Email is not set up on this server, so no test email can be sent. Ask whoever runs the server to configure email.';

describe('MessageHistoryList test send when email is off (W57)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue({ items: [], total: 0, skip: 0, limit: 20 });
    mockSendTestEmail.mockReset();
    mockSendTestEmail.mockRejectedValue(createMockApiError(NOT_SET_UP));
    mockToastError.mockReset();
  });

  it("shows the server's reason", async () => {
    const user = userEvent.setup();
    render(<MessageHistoryList templates={[]} />);

    await user.click(await screen.findByText('Send Test Email'));
    await user.type(screen.getByPlaceholderText('admin@example.com'), 'chief@example.org');
    await user.click(screen.getByText('Send Test'));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining(NOT_SET_UP)));
  });
});
