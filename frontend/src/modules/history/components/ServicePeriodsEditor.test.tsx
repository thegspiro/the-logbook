import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { HistoricalMemberFullView } from '../types';

const mockReplacePeriods = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    replacePeriods: (...args: unknown[]) => mockReplacePeriods(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ServicePeriodsEditor } from './ServicePeriodsEditor';

const person = {
  id: 'p1',
  publication_level: 'draft',
  service_periods: [
    {
      id: 'sp1',
      start_date: '1950-01-01',
      start_precision: 'year',
      start_circa: false,
      end_date: '1990-01-01',
      end_precision: 'year',
      end_circa: false,
      is_ongoing: false,
      notes: null,
      titles: [
        { id: 't1', name: 'Chief', held_from_date: '1975-01-01', held_from_precision: 'year', held_from_circa: false },
      ],
    },
  ],
} as unknown as HistoricalMemberFullView;

const titles = [
  { id: 't1', name: 'Chief', source: 'custom' as const, sort_order: 1, is_retired: false, usage_count: 1 },
  { id: 't2', name: 'Captain', source: 'custom' as const, sort_order: 2, is_retired: false, usage_count: 1 },
];

describe('ServicePeriodsEditor', () => {
  beforeEach(() => {
    mockReplacePeriods.mockReset();
    mockReplacePeriods.mockResolvedValue(person);
  });

  it('keeps each held title’s own dates and saves them with the period', async () => {
    render(
      <ServicePeriodsEditor
        person={person}
        titles={titles}
        onTitleAdded={vi.fn()}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('textbox', { name: 'Chief: held from' })).toHaveValue('1975');
    await userEvent.type(screen.getByRole('textbox', { name: 'Chief: held to' }), '1980');
    await userEvent.click(screen.getByRole('button', { name: 'Save service' }));
    const periods = mockReplacePeriods.mock.calls[0]?.[1] as { titles: unknown[]; title_ids: string[] }[];
    expect(periods[0]?.title_ids).toEqual(['t1']);
    expect(periods[0]?.titles).toEqual([
      expect.objectContaining({ title_id: 't1', held_from_date: '1975-01-01', held_to_date: '1980-01-01' }),
    ]);
  });

  it('keeps a title’s dates when another title is added to the period', async () => {
    render(
      <ServicePeriodsEditor
        person={person}
        titles={titles}
        onTitleAdded={vi.fn()}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Titles held: find a title' }), 'Capt');
    await userEvent.click(screen.getByRole('button', { name: 'Captain' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save service' }));
    const periods = mockReplacePeriods.mock.calls[0]?.[1] as { titles: unknown[]; title_ids: string[] }[];
    expect(periods[0]?.title_ids).toEqual(['t1', 't2']);
    expect(periods[0]?.titles).toEqual([
      expect.objectContaining({ title_id: 't1', held_from_date: '1975-01-01' }),
      expect.objectContaining({ title_id: 't2', held_from_date: null }),
    ]);
  });
});
