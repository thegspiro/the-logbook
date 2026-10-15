import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
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
import type { AttendeeEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'late', present: true },
  { name: 'Sam Absent', status: 'absent', present: false },
  { name: 'A visitor', status: 'guest', present: false },
];

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
        attendees={roll}
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

  describe('motion to adopt', () => {
    it('states the motion for what was decided', async () => {
      const user = userEvent.setup();
      open();

      expect(await screen.findByText('To adopt the minutes as presented.')).toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: 'As amended' }));
      expect(screen.getByText('To adopt the minutes as amended.')).toBeInTheDocument();
    });

    it('offers only members recorded as present to move and second', async () => {
      open();
      await screen.findByRole('option', { name: /November business meeting/ });

      const mover = screen.getByLabelText('Moved by');
      const names = within(mover)
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(names).toEqual(['Choose from the roll…', 'Pat Chief', 'Lee Treasurer', 'Someone else (type a name)']);
    });

    it('sends who moved and who seconded', async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole('option', { name: /November business meeting/ });

      await user.selectOptions(screen.getByLabelText('Moved by'), 'Pat Chief');
      await user.selectOptions(screen.getByLabelText('Seconded by'), 'Lee Treasurer');
      await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

      expect(onAdopt).toHaveBeenCalledWith({
        adopted_on: expect.stringMatching(/Z$/) as unknown,
        adopting_minutes_id: undefined,
        as_amended: false,
        moved_by: 'Pat Chief',
        seconded_by: 'Lee Treasurer',
      });
    });

    it('takes a typed name for a guest', async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole('option', { name: /November business meeting/ });

      await user.selectOptions(screen.getByLabelText('Moved by'), 'Someone else (type a name)');
      await user.type(screen.getByLabelText('Moved by, typed name'), 'Chief Emeritus Alvarez');
      await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

      expect(onAdopt).toHaveBeenCalledWith(expect.objectContaining({ moved_by: 'Chief Emeritus Alvarez' }));
    });

    it('does not let the mover second, even by typing the name', async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole('option', { name: /November business meeting/ });

      await user.selectOptions(screen.getByLabelText('Moved by'), 'Someone else (type a name)');
      await user.type(screen.getByLabelText('Moved by, typed name'), 'Guest Person');
      await user.selectOptions(screen.getByLabelText('Seconded by'), 'Someone else (type a name)');
      await user.type(screen.getByLabelText('Seconded by, typed name'), 'guest person');
      await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('cannot also second');
      expect(onAdopt).not.toHaveBeenCalled();
    });

    it('leaves the mover out of the seconder choices', async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole('option', { name: /November business meeting/ });

      await user.selectOptions(screen.getByLabelText('Moved by'), 'Pat Chief');

      expect(within(screen.getByLabelText('Seconded by')).queryByRole('option', { name: 'Pat Chief' })).toBeNull();
    });

    it('records no movers when none are chosen', async () => {
      const user = userEvent.setup();
      open();
      await screen.findByRole('option', { name: /November business meeting/ });
      await user.click(screen.getByRole('button', { name: 'Adopt Minutes' }));

      const sent = onAdopt.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(sent.moved_by).toBeUndefined();
      expect(sent.seconded_by).toBeUndefined();
    });
  });
});
