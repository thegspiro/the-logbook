const mockPreview = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../../modules/scheduling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../../modules/scheduling');
  return {
    ...actual,
    schedulingService: {
      previewStandingShift: (...args: unknown[]) => mockPreview(...args) as unknown,
      createStandingShift: (...args: unknown[]) => mockCreate(...args) as unknown,
    },
  };
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StandingShiftPeriod } from '../../../modules/scheduling';
import StandingShiftModal from './StandingShiftModal';
import {
  defaultSeriesEnd,
  describeCoverage,
  seriesEndBounds,
  seriesEndError,
} from '../../../modules/scheduling/utils/standingShift';

const onClose = vi.fn();
const onCreated = vi.fn();

const preview = (overrides: Record<string, unknown> = {}) => ({
  dates: [
    { date: '2026-09-01', shift_id: 'x1', status: 'available' },
    { date: '2026-09-08', shift_id: 'x2', status: 'available' },
    { date: '2026-09-15', shift_id: 'x3', status: 'conflict' },
  ],
  claimable_count: 2,
  conflict_count: 1,
  missing_count: 0,
  ...overrides,
});

const renderModal = () =>
  render(
    <StandingShiftModal
      initialWeekday={2}
      initialPeriod={StandingShiftPeriod.NIGHT}
      initialPosition="firefighter"
      timezone="America/New_York"
      onClose={onClose}
      onCreated={onCreated}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockPreview.mockResolvedValue(preview());
  mockCreate.mockResolvedValue({ claim: { id: 'c1' }, claimed: 2, skipped: 1, no_shift: 0 });
});

describe('StandingShiftModal', () => {
  it('says how many dates the member is committing to, on the button', async () => {
    renderModal();
    expect(await screen.findByRole('button', { name: /add 2 shifts/i })).toBeInTheDocument();
  });

  it('seeds the pattern from the shift the member was looking at', async () => {
    renderModal();
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ weekday: 2, period: 'night', pattern: 'weekly' })
    );
  });

  it('re-reads the dates when the pattern changes', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('button', { name: /add 2 shifts/i });
    await user.click(screen.getByRole('button', { name: /every other week/i }));
    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(expect.objectContaining({ pattern: 'biweekly' })));
  });

  it('re-reads the dates when the weekday changes', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('button', { name: /add 2 shifts/i });
    await user.click(screen.getByRole('button', { name: 'Friday' }));
    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(expect.objectContaining({ weekday: 5 })));
  });

  it('names the conflicts rather than quietly dropping them from the count', async () => {
    renderModal();
    expect(await screen.findByText(/conflicts with a shift you already hold/i)).toBeInTheDocument();
  });

  it('will not save a pattern that covers nothing', async () => {
    mockPreview.mockResolvedValue(preview({ dates: [], claimable_count: 0, conflict_count: 0 }));
    renderModal();
    expect(await screen.findByRole('button', { name: /no dates to add/i })).toBeDisabled();
  });

  it('saves the pattern the member chose', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('button', { name: /add 2 shifts/i }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ weekday: 2, period: 'night', position: 'firefighter' })
      )
    );
    expect(onCreated).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open when saving fails', async () => {
    mockCreate.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('button', { name: /add 2 shifts/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('describeCoverage', () => {
  it('confirms a clean run', () => {
    expect(describeCoverage(4, 0, 0)).toBe('No conflicts with shifts you already hold. 4 dates will be claimed now.');
  });

  it('uses the singular for one date', () => {
    expect(describeCoverage(1, 0, 0)).toContain('1 date will be claimed now');
  });

  it('reports conflicts as skipped', () => {
    expect(describeCoverage(3, 2, 0)).toBe(
      '2 of these dates conflict with a shift you already hold. They will be skipped.'
    );
  });

  it('separates "not scheduled yet" from a conflict', () => {
    // Not a problem — just a month the department has not built yet, and the
    // series will pick it up when they do.
    const text = describeCoverage(3, 0, 2);
    expect(text).toContain('not on the schedule yet');
    expect(text).toContain('claimed once scheduled');
    expect(text).not.toContain('conflict');
  });

  it('reports both when both apply', () => {
    const text = describeCoverage(1, 1, 1);
    expect(text).toContain('conflicts with a shift you already hold');
    expect(text).toContain('not on the schedule yet');
  });
});

describe('the series horizon', () => {
  it('defaults to a year out, not the end of the calendar year', async () => {
    // "Through December" shrinks as the year goes on: set one up on Boxing
    // Day and it covers almost nothing, for no reason the member can see.
    renderModal();
    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    const call = mockPreview.mock.calls[0]?.[0] as { start_date: string; end_date: string };
    const span = (Date.parse(`${call.end_date}T00:00:00Z`) - Date.parse(`${call.start_date}T00:00:00Z`)) / 86_400_000;
    expect(span).toBe(364);
  });

  it('lets the member choose a different end date', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByRole('button', { name: /add 2 shifts/i });

    const input = screen.getByLabelText(/last date this standing shift covers/i);
    const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await user.clear(input);
    await user.type(input, soon);

    await waitFor(() => expect(mockPreview).toHaveBeenLastCalledWith(expect.objectContaining({ end_date: soon })));
  });

  it('bounds the picker rather than leaving the server to refuse it', async () => {
    renderModal();
    const input = await screen.findByLabelText(/last date this standing shift covers/i);
    expect(input).toHaveAttribute('min');
    expect(input).toHaveAttribute('max');
  });
});

describe('series horizon helpers', () => {
  const TODAY = '2026-08-23';

  it('defaults to just under a year, inside the server cap', () => {
    const end = defaultSeriesEnd(TODAY);
    expect(end).toBe('2027-08-22');
    expect(seriesEndError(TODAY, end)).toBeNull();
  });

  it('rejects a range shorter than a week', () => {
    // A "standing" shift covering one date is a single signup with extra steps.
    expect(seriesEndError(TODAY, '2026-08-25')).toMatch(/at least a week/i);
  });

  it('rejects a range past the server cap', () => {
    expect(seriesEndError(TODAY, '2029-01-01')).toMatch(/at most a year/i);
  });

  it('accepts the cap exactly', () => {
    expect(seriesEndError(TODAY, seriesEndBounds(TODAY).max)).toBeNull();
  });

  it('asks for a date rather than throwing on a cleared field', () => {
    expect(seriesEndError(TODAY, '')).toMatch(/choose an end date/i);
  });

  it('does not drift across a month boundary', () => {
    // Anchored at UTC midnight: parsing a calendar date as local midnight and
    // formatting it back can move it a day for viewers west of UTC.
    expect(seriesEndBounds('2026-12-28').min).toBe('2027-01-04');
  });
});
