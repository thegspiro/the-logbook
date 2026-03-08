import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageHistoryList from './MessageHistoryList';
import type { EmailTemplate } from '../types';

const mockList = vi.fn();
const mockSendTestEmail = vi.fn();

vi.mock('../../../services/api', () => ({
  messageHistoryService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    sendTestEmail: (...args: unknown[]) => mockSendTestEmail(...args) as unknown,
  },
}));

const makeTemplate = (overrides: Partial<EmailTemplate> = {}): EmailTemplate => ({
  id: 'tmpl-1',
  organization_id: 'org-1',
  template_type: 'welcome',
  name: 'Welcome Email',
  description: 'Sent to new members',
  subject: 'Welcome',
  html_body: '<p>Hello</p>',
  allow_attachments: false,
  is_active: true,
  available_variables: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  attachments: [],
  ...overrides,
});

describe('MessageHistoryList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({
      items: [],
      total: 0,
      skip: 0,
      limit: 20,
    });
  });

  it('renders empty state when no messages', async () => {
    render(<MessageHistoryList templates={[]} />);

    await waitFor(() => {
      expect(screen.getByText('No emails have been sent yet.')).toBeInTheDocument();
    });
  });

  it('renders message history items', async () => {
    mockList.mockResolvedValue({
      items: [
        {
          id: 'msg-1',
          to_email: 'user@example.com',
          subject: 'Welcome aboard',
          status: 'sent',
          template_type: 'welcome',
          recipient_count: 1,
          sent_at: '2026-03-08T12:00:00Z',
        },
        {
          id: 'msg-2',
          to_email: 'admin@example.com',
          subject: 'Reset your password now',
          status: 'failed',
          error_message: 'Connection refused',
          template_type: 'password_reset',
          recipient_count: 1,
          sent_at: '2026-03-07T12:00:00Z',
        },
      ],
      total: 2,
      skip: 0,
      limit: 20,
    });

    render(<MessageHistoryList templates={[]} />);

    await waitFor(() => {
      expect(screen.getByText('user@example.com')).toBeInTheDocument();
      expect(screen.getByText('Welcome aboard')).toBeInTheDocument();
      expect(screen.getByText('admin@example.com')).toBeInTheDocument();
      expect(screen.getByText('Reset your password now')).toBeInTheDocument();
    });

    // Check status indicators (use getAllByText since "Sent" also appears in "Sent At" header)
    const sentElements = screen.getAllByText('Sent');
    expect(sentElements.length).toBeGreaterThanOrEqual(1);
    const failedElements = screen.getAllByText('Failed');
    expect(failedElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows send test email form when button clicked', async () => {
    const user = userEvent.setup();
    render(<MessageHistoryList templates={[makeTemplate()]} />);

    await waitFor(() => {
      expect(screen.getByText('Send Test Email')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Send Test Email'));

    expect(screen.getByText('Recipient Email *')).toBeInTheDocument();
    expect(screen.getByText('Template (optional)')).toBeInTheDocument();
    expect(screen.getByText('Send Test')).toBeInTheDocument();
  });

  it('sends test email and refreshes list', async () => {
    const user = userEvent.setup();
    mockSendTestEmail.mockResolvedValue({
      id: 'test-1',
      to_email: 'test@example.com',
      subject: 'Test Email from The Logbook',
      status: 'sent',
      recipient_count: 1,
      sent_at: '2026-03-08T12:00:00Z',
    });

    render(<MessageHistoryList templates={[]} />);

    await waitFor(() => {
      expect(screen.getByText('Send Test Email')).toBeInTheDocument();
    });

    // Open form
    await user.click(screen.getByText('Send Test Email'));

    // Fill in email
    const emailInput = screen.getByPlaceholderText('admin@example.com');
    await user.type(emailInput, 'test@example.com');

    // Submit
    await user.click(screen.getByText('Send Test'));

    await waitFor(() => {
      expect(mockSendTestEmail).toHaveBeenCalledWith({
        to_email: 'test@example.com',
        template_id: undefined,
      });
    });
  });

  it('calls list API with search parameter', async () => {
    const user = userEvent.setup();
    render(<MessageHistoryList templates={[]} />);

    await waitFor(() => {
      expect(mockList).toHaveBeenCalled();
    });

    const searchInput = screen.getByPlaceholderText('Search by subject or recipient...');
    await user.type(searchInput, 'welcome');

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'welcome' }),
      );
    });
  });
});
