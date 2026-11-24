import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { DoubleCreditView } from '../../types/training';

const mockGet = vi.fn();
const mockKeepBoth = vi.fn();
const mockVoid = vi.fn();

vi.mock('../../services/api', () => ({
  trainingService: {
    getDoubleCredit: (...a: unknown[]) => mockGet(...a) as unknown,
    keepBothDoubleCredit: (...a: unknown[]) => mockKeepBoth(...a) as unknown,
    voidRecord: (...a: unknown[]) => mockVoid(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import DoubleCreditPanel from './DoubleCreditPanel';

const VIEW: DoubleCreditView = {
  items: [
    {
      id: 'flag-1',
      user_id: 'u-1',
      member_name: 'Pat Tester',
      match_reason: 'same_name',
      detected_at: '2026-11-20T15:00:00Z',
      event_record: {
        id: 'rec-event',
        course_name: 'Hose Ops',
        completion_date: '2026-11-19',
        hours_completed: 4,
        source_event_id: 'ev-1',
      },
      other_record: {
        id: 'rec-self',
        course_name: 'hose ops.',
        completion_date: '2026-11-19',
        hours_completed: 3,
        source_event_id: null,
      },
      other_from_self_report: true,
    },
  ],
  total: 1,
};

describe('DoubleCreditPanel', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockKeepBoth, mockVoid]) mock.mockReset();
    mockGet.mockResolvedValue(VIEW);
    mockKeepBoth.mockResolvedValue(VIEW.items[0]);
    mockVoid.mockResolvedValue(undefined);
  });

  it('shows both records of each pair and where the other came from', async () => {
    renderWithRouter(<DoubleCreditPanel />);

    const item = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    expect(item).toHaveTextContent('Pat Tester');
    expect(item).toHaveTextContent('Same name');
    expect(item).toHaveTextContent('From the event');
    expect(item).toHaveTextContent('Hose Ops');
    expect(item).toHaveTextContent('4 hours');
    expect(item).toHaveTextContent('Self-report');
    expect(item).toHaveTextContent('hose ops.');
    expect(item).toHaveTextContent('3 hours');
    expect(mockGet).toHaveBeenCalledWith();
  });

  it('keeps both after confirmation, then tells the hub', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<DoubleCreditPanel onResolved={onResolved} />);
    await user.click(await screen.findByRole('button', { name: 'Keep both records for Pat Tester' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('keeps 4 hours from the event and 3 hours from the other record');
    await user.click(within(dialog).getByRole('button', { name: 'Keep both' }));

    await waitFor(() => expect(mockKeepBoth).toHaveBeenCalledWith('flag-1'));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockVoid).not.toHaveBeenCalled();
  });

  it('voids the chosen record with the reason typed, then tells the hub', async () => {
    const onResolved = vi.fn();
    const user = userEvent.setup();
    renderWithRouter(<DoubleCreditPanel onResolved={onResolved} />);
    await user.click(await screen.findByRole('button', { name: 'Void the self-report for Pat Tester' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Same class as the drill');
    await user.click(within(dialog).getByRole('button', { name: 'Void record' }));

    await waitFor(() => expect(mockVoid).toHaveBeenCalledWith('rec-self', 'Same class as the drill'));
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(mockKeepBoth).not.toHaveBeenCalled();
  });

  it('says nothing is waiting when there are no pairs', async () => {
    mockGet.mockResolvedValue({ items: [], total: 0 });
    renderWithRouter(<DoubleCreditPanel />);

    expect(await screen.findByText('No possible double credit')).toBeInTheDocument();
  });
});
