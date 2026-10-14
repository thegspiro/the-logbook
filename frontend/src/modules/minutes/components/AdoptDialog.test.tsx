import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAll = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: { listAllMinutes: (...a: unknown[]) => mockAll(...a) as unknown },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('../../../components/ux/DateTimeQuarterHour', () => ({
  default: ({ value, onChange, timeLabel }: { value: string; onChange: (v: string) => void; timeLabel?: string }) => (
    <input aria-label={timeLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { AdoptDialog } from './AdoptDialog';
import { renderWithRouter } from '../../../test/utils';
import { localToUTC } from '../../../utils/dateFormatting';

describe('AdoptDialog', () => {
  const onAdopt = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReset();
    mockAll.mockResolvedValue([
      { id: 'm1', title: 'This one', meeting_date: '2026-10-01T23:00:00Z' },
      { id: 'm2', title: 'November business meeting', meeting_date: '2026-11-05T01:00:00Z' },
    ]);
  });

  const open = (hasAccepted = false) =>
    renderWithRouter(
      <AdoptDialog
        isOpen
        minutesId="m1"
        hasAcceptedSuggestions={hasAccepted}
        busy={false}
        onClose={onClose}
        onAdopt={onAdopt}
      />
    );

  it('defaults to as presented, dated now, with no meeting named', async () => {
    const user = userEvent.setup();
    open();

    await screen.findByRole('option', { name: /November business meeting/ });
    await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

    expect(onAdopt).toHaveBeenCalledWith({
      adopted_on: expect.stringMatching(/Z$/) as unknown,
      adopting_minutes_id: undefined,
      as_amended: false,
    });
  });

  it('does not list the minutes among the meetings they could be adopted at', async () => {
    open();
    await screen.findByRole('option', { name: /November business meeting/ });
    expect(screen.queryByRole('option', { name: /This one/ })).not.toBeInTheDocument();
  });

  it('preselects “as amended” when a suggestion was accepted, and says why', async () => {
    open(true);
    expect(await screen.findByRole('radio', { name: 'As amended' })).toBeChecked();
    expect(screen.getByText(/A suggestion was accepted/)).toBeInTheDocument();
  });

  it('records the vote time in the department’s zone, the meeting, and the override', async () => {
    const user = userEvent.setup();
    open(true);

    await screen.findByRole('option', { name: /November business meeting/ });
    fireEvent.change(screen.getByLabelText('Adoption vote'), { target: { value: '2026-11-04T19:30' } });
    await user.selectOptions(screen.getByLabelText('At which meeting'), 'm2');
    await user.click(screen.getByRole('radio', { name: 'As presented' }));
    await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

    expect(onAdopt).toHaveBeenCalledWith({
      adopted_on: localToUTC('2026-11-04T19:30', 'America/Chicago'),
      adopting_minutes_id: 'm2',
      as_amended: false,
    });
  });

  it('still offers adoption when the list of meetings cannot be loaded', async () => {
    mockAll.mockRejectedValue(new Error('403'));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: 'Adopt Minutes' }));
    expect(onAdopt).toHaveBeenCalledTimes(1);
  });

  it('warns that adoption locks the minutes', async () => {
    open();
    expect(await screen.findByText(/these minutes are locked/)).toBeInTheDocument();
  });
});
