import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { StaffingLeftoversView } from '../../../modules/integrations/types/historicalImport';

const mockList = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getStaffingLeftovers: (...a: unknown[]) => mockList(...a) as unknown,
    updateStaffingLeftovers: (...a: unknown[]) => mockUpdate(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import StaffingLeftovers from './StaffingLeftovers';

const seats: StaffingLeftoversView = {
  kind: 'signups',
  total: 1,
  members: [{ id: 'u-1', name: 'Alice Ng' }],
  items: [
    {
      key: 'seat-501-4',
      state: 'open',
      date: '2016-05-03',
      member_id: 'u-1',
      member: 'Alice Ng',
      activity: 'A106E NS',
      title: 'Driver',
      paired_with: null,
      candidates: [
        { attendance_id: 'att-9', date: '2016-05-03', start: '2016-05-03T08:00:00Z', end: '2016-05-03T12:00:00Z' },
      ],
    },
  ],
};

const hours: StaffingLeftoversView = {
  kind: 'hours',
  total: 1,
  members: [{ id: 'u-1', name: 'Alice Ng' }],
  items: [
    {
      key: 'att-9',
      state: 'open',
      date: '2016-05-03',
      member_id: 'u-1',
      member: 'Alice Ng',
      attendance_id: 'att-9',
      start: '2016-05-03T08:00:00Z',
      end: '2016-05-03T12:00:00Z',
    },
  ],
};

describe('StaffingLeftovers', () => {
  const onChanged = vi.fn();

  beforeEach(() => {
    mockList.mockReset();
    mockUpdate.mockReset();
    onChanged.mockReset();
    mockList.mockImplementation((_id: string, query: { kind: string }) =>
      Promise.resolve(query.kind === 'hours' ? hours : seats)
    );
    mockUpdate.mockResolvedValue(undefined);
  });

  it('pairs a seat with one of its member’s hours entries', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingLeftovers importId="imp-1" tz="UTC" onChanged={onChanged} />);

    const pair = await screen.findByLabelText("Pair Alice Ng's Driver seat with hours");
    await user.selectOptions(pair, 'att-9');

    expect(mockUpdate).toHaveBeenCalledWith('imp-1', { pairs: { 'seat-501-4': 'att-9' } });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('marks an hours entry reviewed by its own key', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingLeftovers importId="imp-1" tz="UTC" onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: 'Hours with no seat' }));
    // The hours row names the member alone; the seat row reads "Alice Ng · Driver".
    await screen.findByText('Alice Ng', { selector: 'p' });
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));

    expect(mockUpdate).toHaveBeenCalledWith('imp-1', { reviewed: { 'hours:att-9': true } });
  });

  it('asks the server for one member and the resolved entries too', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingLeftovers importId="imp-1" tz="UTC" onChanged={onChanged} />);

    await screen.findByText('Alice Ng · Driver');
    await user.selectOptions(screen.getByLabelText('Member'), 'u-1');
    await user.click(screen.getByRole('checkbox', { name: 'Show paired and reviewed' }));

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith('imp-1', {
        kind: 'signups',
        member_id: 'u-1',
        date_from: undefined,
        date_to: undefined,
        show_resolved: true,
        offset: 0,
        limit: 25,
      })
    );
  });
});
