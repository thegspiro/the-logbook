import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../services/api', () => ({
  apparatusEventService: {
    checkConflicts: () => Promise.resolve([]),
    scheduleNights: vi.fn(),
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { renderWithRouter } from '../../test/utils';
import ScheduleNightsForm from './ScheduleNightsForm';
import type { ApparatusEventTemplate } from '../../types/apparatusEvent';

const template = {
  id: 'tpl-santa',
  name: 'Santamobile',
  default_start_time: '18:00',
  duration_minutes: 180,
  location: 'Station 1',
  total_seats: 7,
  evoc_mode: 'enforce',
  admin_hours_category_name: 'Community Outreach',
} as unknown as ApparatusEventTemplate;

const dateOf = (n: number) => screen.getByLabelText(`Night ${n}`);

describe('ScheduleNightsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a run of nights in a row, copying the last night', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ScheduleNightsForm template={template} onScheduled={vi.fn()} onCancel={vi.fn()} />);

    await user.clear(dateOf(1));
    await user.type(dateOf(1), '2026-12-18');
    await user.clear(screen.getAllByLabelText('Hours')[0]!);
    await user.type(screen.getAllByLabelText('Hours')[0]!, '2.5');
    await user.clear(screen.getByLabelText('More nights after the last one'));
    await user.type(screen.getByLabelText('More nights after the last one'), '3');
    await user.click(screen.getByRole('button', { name: 'Every day' }));

    expect([1, 2, 3, 4].map((n) => (dateOf(n) as HTMLInputElement).value)).toEqual([
      '2026-12-18',
      '2026-12-19',
      '2026-12-20',
      '2026-12-21',
    ]);
    // The length typed on night 1 carries forward, shown in hours.
    expect(screen.getAllByLabelText('Hours').map((el) => (el as HTMLInputElement).value)).toEqual([
      '2.5',
      '2.5',
      '2.5',
      '2.5',
    ]);
    expect(screen.getByRole('button', { name: 'Create 4 nights' })).toBeInTheDocument();
  });

  it('still adds nights a week apart', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ScheduleNightsForm template={template} onScheduled={vi.fn()} onCancel={vi.fn()} />);

    await user.clear(dateOf(1));
    await user.type(dateOf(1), '2026-12-01');
    await user.clear(screen.getByLabelText('More nights after the last one'));
    await user.type(screen.getByLabelText('More nights after the last one'), '2');
    await user.click(screen.getByRole('button', { name: 'Every week' }));

    expect([1, 2, 3].map((n) => (dateOf(n) as HTMLInputElement).value)).toEqual([
      '2026-12-01',
      '2026-12-08',
      '2026-12-15',
    ]);
  });

  it('starts each night at the template length, shown in hours', () => {
    renderWithRouter(<ScheduleNightsForm template={template} onScheduled={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Hours')).toHaveValue(3);
  });
});
