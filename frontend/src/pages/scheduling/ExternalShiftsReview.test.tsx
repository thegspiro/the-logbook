import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ExternalShiftsReview } from './ExternalShiftsReview';
import type { ExternalShiftEntry } from '../../modules/scheduling/services/api';

const mockList = vi.fn();
const mockReject = vi.fn();
const mockRestore = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getExternalShifts: (...args: unknown[]) => mockList(...args) as unknown,
    rejectExternalShift: (...args: unknown[]) => mockReject(...args) as unknown,
    restoreExternalShift: (...args: unknown[]) => mockRestore(...args) as unknown,
  },
}));

const entry = (over: Partial<ExternalShiftEntry> = {}): ExternalShiftEntry => ({
  id: 'e1',
  user_id: 'u1',
  member_name: 'Casey Reed',
  shift_date: '2026-03-04',
  hours: 12,
  agency_name: 'Township Fire Company',
  apparatus: null,
  role: null,
  notes: null,
  status: 'counted',
  reviewed_by: null,
  reviewer_name: null,
  reviewed_at: null,
  rejection_reason: null,
  created_at: '2026-03-05T12:00:00Z',
  updated_at: '2026-03-05T12:00:00Z',
  ...over,
});

describe('ExternalShiftsReview', () => {
  const onChanged = vi.fn();

  beforeEach(() => {
    mockList.mockReset();
    mockReject.mockReset();
    mockRestore.mockReset();
    onChanged.mockReset();
    mockList.mockResolvedValue({ items: [entry()], total: 1 });
    mockReject.mockResolvedValue(entry({ status: 'rejected' }));
    mockRestore.mockResolvedValue(entry());
  });

  it('loads the report period', async () => {
    renderWithRouter(
      <ExternalShiftsReview startDate="2026-03-01" endDate="2026-03-31" canManage onChanged={onChanged} />
    );

    expect(await screen.findByText('Casey Reed')).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith({ start_date: '2026-03-01', end_date: '2026-03-31', limit: 200 });
  });

  it('rejects with a reason and refreshes the totals', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <ExternalShiftsReview startDate="2026-03-01" endDate="2026-03-31" canManage onChanged={onChanged} />
    );

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'Not on the mutual aid roster');
    await user.click(within(dialog).getByRole('button', { name: 'Reject shift' }));

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('e1', 'Not on the mutual aid roster'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('restores a rejected entry', async () => {
    mockList.mockResolvedValue({
      items: [entry({ status: 'rejected', rejection_reason: 'Duplicate', reviewer_name: 'Lt. Park' })],
      total: 1,
    });
    const user = userEvent.setup();
    renderWithRouter(
      <ExternalShiftsReview startDate="2026-03-01" endDate="2026-03-31" canManage onChanged={onChanged} />
    );

    expect(await screen.findByText('Duplicate — Lt. Park')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('e1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers no actions to a report-only viewer', async () => {
    renderWithRouter(
      <ExternalShiftsReview startDate="2026-03-01" endDate="2026-03-31" canManage={false} onChanged={onChanged} />
    );

    expect(await screen.findByText('Casey Reed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <ExternalShiftsReview startDate="2026-03-01" endDate="2026-03-31" canManage onChanged={onChanged} />
    );
    await screen.findByText('Casey Reed');

    await user.selectOptions(screen.getByLabelText('Show'), 'rejected');

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith({
        start_date: '2026-03-01',
        end_date: '2026-03-31',
        limit: 200,
        status: 'rejected',
      })
    );
  });
});
