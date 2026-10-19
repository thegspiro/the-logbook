/**
 * MSG-12: a department-message email that ran out of retries is shown as
 * failed in the per-member delivery list (the acknowledgment report), and one
 * still waiting for its next try says so. A delivered one adds nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AcknowledgmentReport, DepartmentMessageRecord } from '../../../services/adminServices';

const mockGetMessages = vi.fn();
const mockGetReport = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    getMessages: (...a: unknown[]) => mockGetMessages(...a) as unknown,
    getAvailableRoles: () => Promise.resolve([]),
    getAcknowledgmentReport: (...a: unknown[]) => mockGetReport(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import MessagesAdminPage from './MessagesAdminPage';
import { renderWithRouter } from '../../../test/utils';

const message = {
  id: 'm1',
  organization_id: 'org-1',
  title: 'Roof collapse drill',
  body: '0700 Saturday',
  priority: 'normal',
  target_type: 'all',
  is_active: true,
  is_pinned: false,
  is_persistent: false,
  requires_acknowledgment: false,
  created_at: '2026-10-11T10:00:00Z',
} as unknown as DepartmentMessageRecord;

const report: AcknowledgmentReport = {
  message_id: 'm1',
  requires_acknowledgment: false,
  total_targeted: 3,
  total_read: 0,
  total_acknowledged: 0,
  recipients: [
    {
      user_id: 'u1',
      name: 'Ann Adams',
      is_read: false,
      is_acknowledged: false,
      email_delivery: {
        status: 'failed',
        attempts: 6,
        error: 'The provider refused the message or could not be reached',
      },
    },
    {
      user_id: 'u2',
      name: 'Ben Brown',
      is_read: false,
      is_acknowledged: false,
      email_delivery: {
        status: 'retrying',
        attempts: 1,
        next_attempt_at: '2026-10-11T12:05:00Z',
        error: "Held back by the department's hourly sending limit",
      },
    },
    {
      user_id: 'u3',
      name: 'Cy Cole',
      is_read: false,
      is_acknowledged: false,
      email_delivery: { status: 'delivered', attempts: 1 },
    },
  ],
};

describe('MessagesAdminPage — delivery state in the report (MSG-12)', () => {
  beforeEach(() => {
    mockGetMessages.mockReset();
    mockGetReport.mockReset();
    mockGetMessages.mockResolvedValue({ messages: [message], total: 1 });
    mockGetReport.mockResolvedValue(report);
  });

  it('shows a failed email as failed and a pending retry with its time', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MessagesAdminPage />);

    await user.click(await screen.findByRole('button', { name: 'View acknowledgments for Roof collapse drill' }));

    expect(
      await screen.findByText('Email failed — The provider refused the message or could not be reached')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Email not sent yet, trying again .+ — Held back by the department/)).toBeInTheDocument();
    // Nothing is added for the member whose email went out.
    expect(screen.getAllByText(/^Email /)).toHaveLength(2);
  });
});
