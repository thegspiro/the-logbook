import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const scheduleEmail = vi.fn();
const clearError = vi.fn();

vi.mock('../store/scheduledEmailsStore', () => ({
  useScheduledEmailsStore: () => ({ scheduleEmail, clearError, isSaving: false, error: null }),
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { renderWithRouter } from '../../../test/utils';
import ScheduleEmailForm from './ScheduleEmailForm';
import type { EmailTemplate } from '../types';

const template = { id: 't1', template_type: 'welcome', name: 'Welcome' } as unknown as EmailTemplate;

describe('ScheduleEmailForm', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    scheduleEmail.mockReset();
    clearError.mockReset();
    onClose.mockReset();
  });

  const open = () => renderWithRouter(<ScheduleEmailForm templates={[template]} onClose={onClose} />);

  it('puts a 422 on the recipient field and announces it', async () => {
    scheduleEmail.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'to_emails.0', message: 'value is not a valid email address' }] },
      },
    });
    const user = userEvent.setup();
    open();

    await user.selectOptions(screen.getByLabelText(/^Template Type/), 'welcome');
    await user.type(screen.getByLabelText(/^To \(comma-separated emails\)/), 'chief@example.org');
    await user.type(screen.getByLabelText(/^Date/), '2099-01-01');
    await user.selectOptions(screen.getByLabelText('Time hour'), '9');
    await user.click(screen.getByRole('button', { name: 'Schedule Email' }));

    const to = screen.getByLabelText(/^To \(comma-separated emails\)/);
    await waitFor(() => expect(to).toHaveAccessibleDescription('value is not a valid email address'));
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws typed recipients away', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/^To \(comma-separated emails\)/), 'chief@example.org');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^To \(comma-separated emails\)/)).toHaveValue('chief@example.org');
  });
});
