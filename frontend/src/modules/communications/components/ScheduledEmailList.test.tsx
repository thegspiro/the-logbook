import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCancel = vi.fn();
const mockList = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../services/api', () => ({
  scheduledEmailsService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    create: vi.fn(),
    cancel: (...args: unknown[]) => mockCancel(...args) as unknown,
    update: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ScheduledEmailList from './ScheduledEmailList';
import { useScheduledEmailsStore } from '../store/scheduledEmailsStore';

const pending = {
  id: 'se1',
  organization_id: 'org-1',
  template_type: 'custom',
  to_emails: ['member@example.test'],
  scheduled_at: '2026-11-01T12:00:00Z',
  status: 'pending',
  created_at: '2026-10-01T12:00:00Z',
};

const cancelThroughDialog = async () => {
  const user = userEvent.setup();
  render(<ScheduledEmailList />);
  await user.click(await screen.findByRole('button', { name: 'Cancel scheduled email' }));
  await user.click(screen.getByRole('button', { name: 'Cancel Email' }));
};

describe('ScheduledEmailList cancelling an email', () => {
  beforeEach(() => {
    useScheduledEmailsStore.setState({ scheduledEmails: [], isLoading: false, isSaving: false, error: null });
    mockList.mockReset();
    mockList.mockResolvedValue([pending]);
    mockCancel.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  it('reports success and shows the email as cancelled', async () => {
    mockCancel.mockResolvedValue(undefined);

    await cancelThroughDialog();

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Scheduled email cancelled'));
    expect(mockToastError).not.toHaveBeenCalled();
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
  });

  it("shows the server's reason, not success, when the cancel fails", async () => {
    mockCancel.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        response: { data: { detail: 'This email has already been sent and cannot be cancelled' }, status: 400 },
      })
    );

    await cancelThroughDialog();

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('This email has already been sent and cannot be cancelled')
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('does nothing when the dialog is dismissed', async () => {
    const user = userEvent.setup();
    render(<ScheduledEmailList />);

    await user.click(await screen.findByRole('button', { name: 'Cancel scheduled email' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
