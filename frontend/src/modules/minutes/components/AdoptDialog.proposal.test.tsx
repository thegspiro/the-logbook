import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
import type { AdoptionProposal, AttendeeEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'present', present: true },
];

const proposal: AdoptionProposal = {
  motion_id: 'mo1',
  adopted_on: '2026-10-02T00:00:00Z',
  adopting_minutes_id: 'm2',
  adopting_minutes_title: 'October business',
  as_amended: true,
  moved_by: 'Pat Chief',
  seconded_by: 'Lee Treasurer',
};

describe('AdoptDialog with a proposal from the accepting motion', () => {
  const onAdopt = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReset();
    mockAll.mockResolvedValue([
      { id: 'm1', title: 'This one', meeting_date: '2026-09-03T23:00:00Z' },
      { id: 'm2', title: 'October business', meeting_date: '2026-10-02T00:00:00Z' },
    ]);
  });

  const open = (value: AdoptionProposal | null) =>
    renderWithRouter(
      <AdoptDialog
        isOpen
        minutesId="m1"
        hasAcceptedSuggestions={false}
        proposal={value}
        attendees={roll}
        busy={false}
        onClose={vi.fn()}
        onAdopt={onAdopt}
      />
    );

  it('says where the form was filled in from', async () => {
    open(proposal);

    expect(await screen.findByText(/Filled in from the motion recorded at October business/)).toBeInTheDocument();
  });

  it('opens on the meeting, the choice and the mover and seconder the motion recorded', async () => {
    open(proposal);

    expect(await screen.findByRole('option', { name: /October business/ })).toBeInTheDocument();
    expect(screen.getByLabelText('At which meeting')).toHaveValue('m2');
    expect(screen.getByRole('radio', { name: 'As amended' })).toBeChecked();
    expect(screen.getByLabelText('Moved by')).toHaveValue('Pat Chief');
    expect(screen.getByLabelText('Seconded by')).toHaveValue('Lee Treasurer');
  });

  it('adopts with what the motion recorded', async () => {
    const user = userEvent.setup();
    open(proposal);

    await screen.findByRole('option', { name: /October business/ });
    await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

    expect(onAdopt).toHaveBeenCalledWith(
      expect.objectContaining({
        adopting_minutes_id: 'm2',
        as_amended: true,
        moved_by: 'Pat Chief',
        seconded_by: 'Lee Treasurer',
      })
    );
  });

  it('opens on as submitted when the motion accepted them as submitted', async () => {
    open({ ...proposal, as_amended: false });

    await screen.findByRole('option', { name: /October business/ });
    expect(screen.getByRole('radio', { name: 'As presented' })).toBeChecked();
  });

  it('is the usual blank form without a proposal', async () => {
    open(null);

    await screen.findByRole('option', { name: /October business/ });
    expect(screen.getByLabelText('At which meeting')).toHaveValue('');
    expect(screen.queryByText(/Filled in from/)).not.toBeInTheDocument();
  });
});
