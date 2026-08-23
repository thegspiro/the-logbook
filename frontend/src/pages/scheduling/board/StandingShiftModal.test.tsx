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
import { describeCoverage } from '../../../modules/scheduling/utils/standingShift';

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
