import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ServiceHistory, ServicePeriod } from '../../types/user';

const mockGetServiceHistory = vi.fn();
const mockReplaceServicePeriods = vi.fn();
vi.mock('../../services/api', () => ({
  memberStatusService: {
    getServiceHistory: (...args: unknown[]) => mockGetServiceHistory(...args) as unknown,
    replaceServicePeriods: (...args: unknown[]) => mockReplaceServicePeriods(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks
import { ServiceHistorySection } from './ServiceHistorySection';

const IMPLIED_STINT: ServicePeriod = {
  id: null,
  start_date: '2010-01-01',
  start_is_hire_date: true,
  end_date: null,
  separation_status: null,
  counts_toward_service: true,
  notes: null,
  days: 6000,
};

/** Never left: nothing recorded, one stint implied by the hire date. */
const IMPLIED: ServiceHistory = {
  user_id: 'u1',
  hire_date: '2010-01-01',
  periods: [IMPLIED_STINT],
  credited_days: 6000,
  credited_years: 16,
  prior_days: 0,
  effective_service_start: '2010-01-01',
  is_recorded: false,
  is_estimated: false,
  default_rejoin_credit: 'continue',
};

function renderSection(canEdit = true) {
  return render(<ServiceHistorySection userId="u1" canEdit={canEdit} tz="UTC" />);
}

describe('ServiceHistorySection', () => {
  beforeEach(() => {
    mockGetServiceHistory.mockReset();
    mockGetServiceHistory.mockResolvedValue(IMPLIED);
    mockReplaceServicePeriods.mockReset();
    mockReplaceServicePeriods.mockResolvedValue({ ...IMPLIED, is_recorded: true });
  });

  it('says when service is calculated from the hire date alone', async () => {
    renderSection();

    expect(await screen.findByText('Calculated from the hire date. No time away is recorded.')).toBeInTheDocument();
    expect(screen.getByText('Credited service')).toBeInTheDocument();
    expect(screen.queryByText('Prior service (not counted)')).not.toBeInTheDocument();
  });

  it('offers no editing without members.manage', async () => {
    renderSection(false);

    await screen.findByText('Credited service');
    expect(screen.queryByRole('button', { name: 'Edit service history' })).not.toBeInTheDocument();
  });

  it('corrects the implied stint and adds earlier service in one save', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Edit service history' }));

    // The implied stint arrives as an editable row, still tied to the hire date.
    const first = screen.getByRole('group', { name: 'Stint 1' });
    expect(within(first).getByRole('checkbox', { name: /Starts on the hire date/ })).toBeChecked();
    await user.type(within(first).getByLabelText(/^End/), '2015-01-01');
    await user.selectOptions(within(first).getByLabelText('How it ended'), 'dropped_voluntary');

    await user.click(screen.getByRole('button', { name: 'Add stint' }));
    const second = screen.getByRole('group', { name: 'Stint 2' });
    await user.type(within(second).getByLabelText('Start'), '2020-01-01');

    await user.click(screen.getByRole('button', { name: 'Save history' }));

    await waitFor(() =>
      expect(mockReplaceServicePeriods).toHaveBeenCalledWith('u1', [
        {
          start_date: null,
          end_date: '2015-01-01',
          counts_toward_service: true,
          separation_status: 'dropped_voluntary',
          notes: null,
        },
        {
          start_date: '2020-01-01',
          end_date: null,
          counts_toward_service: true,
          separation_status: null,
          notes: null,
        },
      ])
    );
    expect(await screen.findByRole('button', { name: 'Edit service history' })).toBeInTheDocument();
  });

  it('keeps ids and sends a removed stint by leaving it out', async () => {
    const user = userEvent.setup();
    mockGetServiceHistory.mockResolvedValue({
      ...IMPLIED,
      is_recorded: true,
      periods: [
        { ...IMPLIED_STINT, id: 'p1', end_date: '2015-01-01', separation_status: 'retired' },
        { ...IMPLIED_STINT, id: 'p2', start_is_hire_date: false, start_date: '2020-01-01' },
      ],
    });
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Edit service history' }));
    await user.click(screen.getByRole('button', { name: 'Remove stint 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Counts toward length of service' }));
    await user.click(screen.getByRole('button', { name: 'Save history' }));

    await waitFor(() =>
      expect(mockReplaceServicePeriods).toHaveBeenCalledWith('u1', [
        {
          id: 'p2',
          start_date: '2020-01-01',
          end_date: null,
          counts_toward_service: false,
          separation_status: null,
          notes: null,
        },
      ])
    );
  });

  it('refuses a stint with no start before sending anything', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Edit service history' }));
    await user.click(screen.getByRole('button', { name: 'Add stint' }));
    await user.click(screen.getByRole('button', { name: 'Save history' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Every stint needs a start date.');
    expect(mockReplaceServicePeriods).not.toHaveBeenCalled();
  });

  it('shows the backend refusal and stays in edit mode', async () => {
    const user = userEvent.setup();
    mockReplaceServicePeriods.mockRejectedValue(new Error('Service stints cannot overlap'));
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Edit service history' }));
    await user.click(screen.getByRole('button', { name: 'Save history' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Service stints cannot overlap');
    expect(screen.getByRole('button', { name: 'Save history' })).toBeInTheDocument();
  });
});
