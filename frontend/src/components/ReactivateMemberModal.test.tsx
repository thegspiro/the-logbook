import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockReactivateMember = vi.fn();
const mockGetServiceHistory = vi.fn();
vi.mock('../services/api', () => ({
  memberStatusService: {
    reactivateMember: (...args: unknown[]) => mockReactivateMember(...args) as unknown,
    getServiceHistory: (...args: unknown[]) => mockGetServiceHistory(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => 'UTC',
}));

const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToastSuccess(...args) as unknown, error: vi.fn() },
}));

// Import AFTER mocks
import { ReactivateMemberModal } from './ReactivateMemberModal';
import type { ServiceHistory } from '../types/user';
import { getTodayLocalDate } from '../utils/dateFormatting';

const MEMBER = { id: 'u9', name: 'Pat Returner' };

/** Archived with nothing recorded: one stint from hire, its end estimated. */
const UNRECORDED: ServiceHistory = {
  user_id: 'u9',
  hire_date: '2015-09-24',
  periods: [
    {
      id: null,
      start_date: '2015-09-24',
      start_is_hire_date: true,
      end_date: '2020-09-24',
      separation_status: null,
      counts_toward_service: true,
      notes: null,
      days: 1827,
    },
  ],
  credited_days: 1827,
  credited_years: 5,
  prior_days: 0,
  effective_service_start: '2015-09-24',
  is_recorded: false,
  is_estimated: true,
  default_rejoin_credit: 'continue',
};

describe('ReactivateMemberModal', () => {
  const onClose = vi.fn();
  const onReactivated = vi.fn();

  beforeEach(() => {
    mockReactivateMember.mockReset();
    mockReactivateMember.mockResolvedValue({ user_id: 'u9', new_status: 'active' });
    mockGetServiceHistory.mockReset();
    mockGetServiceHistory.mockResolvedValue(UNRECORDED);
    mockToastSuccess.mockReset();
    onClose.mockReset();
    onReactivated.mockReset();
    onReactivated.mockResolvedValue(undefined);
  });

  function renderModal(isOpen = true) {
    return render(
      <ReactivateMemberModal isOpen={isOpen} onClose={onClose} member={MEMBER} onReactivated={onReactivated} />
    );
  }

  it('names the member, the status they return to, and their earlier service', async () => {
    renderModal();
    // 2015-09-24 to the estimated end, 2020-09-24.
    expect(await screen.findByRole('group', { name: 'Earlier service (5 years)' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Reactivate Member' })).toBeInTheDocument();
    expect(screen.getByText('Pat Returner')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('sends the trimmed reason, refreshes the caller, then closes', async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole('group', { name: /Earlier service/ });
    await user.type(screen.getByLabelText(/Reason/), '  Returned from relocation  ');
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockReactivateMember).toHaveBeenCalledWith('u9', {
      reason: 'Returned from relocation',
      service_credit: 'continue',
      rejoin_date: getTodayLocalDate('UTC'),
      previous_service_end: '2020-09-24',
    });
    expect(onReactivated).toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith('Pat Returner has been reactivated');
  });

  it('omits a blank reason rather than sending an empty string', async () => {
    const user = userEvent.setup();
    renderModal();

    await screen.findByRole('group', { name: /Earlier service/ });
    await user.type(screen.getByLabelText(/Reason/), '   ');
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() =>
      expect(mockReactivateMember).toHaveBeenCalledWith('u9', expect.objectContaining({ reason: undefined }))
    );
  });

  it('keeps the dialog open and shows the error when the backend refuses', async () => {
    const user = userEvent.setup();
    mockReactivateMember.mockRejectedValue(new Error('Only archived members can be reactivated.'));
    renderModal();
    await screen.findByRole('group', { name: /Earlier service/ });

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only archived members can be reactivated.');
    expect(onClose).not.toHaveBeenCalled();
    expect(onReactivated).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('closes without calling the backend on "Keep archived"', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Keep archived' }));

    expect(onClose).toHaveBeenCalled();
    expect(mockReactivateMember).not.toHaveBeenCalled();
  });

  it('clears a reason typed for a previous open', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    await user.type(screen.getByLabelText(/Reason/), 'stale reason');

    rerender(<ReactivateMemberModal isOpen={false} onClose={onClose} member={MEMBER} onReactivated={onReactivated} />);
    rerender(<ReactivateMemberModal isOpen onClose={onClose} member={MEMBER} onReactivated={onReactivated} />);

    expect(screen.getByLabelText(/Reason/)).toHaveValue('');
  });

  it('offers a restart, defaulting to the department setting', async () => {
    const user = userEvent.setup();
    mockGetServiceHistory.mockResolvedValue({ ...UNRECORDED, default_rejoin_credit: 'restart' });
    renderModal();

    const restart = await screen.findByRole('radio', { name: /Restart at zero \(department default\)/ });
    expect(restart).toBeChecked();

    await user.click(screen.getByRole('radio', { name: /Continue prior service/ }));
    await user.clear(screen.getByLabelText('Last day of previous service'));
    await user.type(screen.getByLabelText('Last day of previous service'), '2021-03-31');
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() =>
      expect(mockReactivateMember).toHaveBeenCalledWith(
        'u9',
        expect.objectContaining({ service_credit: 'continue', previous_service_end: '2021-03-31' })
      )
    );
  });

  it('does not ask for the end of earlier service once stints are recorded', async () => {
    const user = userEvent.setup();
    mockGetServiceHistory.mockResolvedValue({ ...UNRECORDED, is_recorded: true, is_estimated: false });
    renderModal();

    await screen.findByRole('group', { name: /Earlier service/ });
    expect(screen.queryByLabelText('Last day of previous service')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() =>
      expect(mockReactivateMember).toHaveBeenCalledWith(
        'u9',
        expect.objectContaining({ previous_service_end: undefined })
      )
    );
  });

  it('still reactivates on the department default when history cannot be loaded', async () => {
    const user = userEvent.setup();
    mockGetServiceHistory.mockRejectedValue(new Error('network'));
    renderModal();

    expect(await screen.findByText(/department.s default applies/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mockReactivateMember).toHaveBeenCalledWith('u9', { reason: undefined }));
  });
});
