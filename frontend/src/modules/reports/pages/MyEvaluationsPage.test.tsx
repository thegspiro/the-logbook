/** A member's own evaluations and their figures for the current period. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { LiveData } from '../types/evaluations';

const mine = vi.fn();
const liveData = vi.fn();
vi.mock('../services/evaluationsApi', () => ({
  evaluationsService: {
    mine: (...a: unknown[]) => mine(...a) as unknown,
    liveData: (...a: unknown[]) => liveData(...a) as unknown,
  },
}));

import MyEvaluationsPage from './MyEvaluationsPage';

const LIVE: LiveData = {
  period_id: 'p1',
  period_name: '2026 Annual',
  coverage_start: '2026-02-01',
  coverage_end: '2026-11-01',
  excluded_ranges: [{ start: '2026-06-01', end: '2026-06-30', reason: 'leave' }],
  sources: [
    {
      key: 'events.meeting_attendance_pct',
      label: 'Business meeting attendance',
      unit: 'percent',
      module: 'events',
      description: '',
      scoreable: true,
    },
    {
      key: 'calls.response_pct',
      label: 'Call response rate',
      unit: 'percent',
      module: 'calls',
      description: '',
      scoreable: true,
    },
  ],
  data: {
    'events.meeting_attendance_pct': { available: true, value: 75 },
    'calls.response_pct': { available: false, value: null, note: 'Call tracking is off for the department.' },
  },
  note: null,
};

describe('MyEvaluationsPage', () => {
  beforeEach(() => {
    mine.mockReset();
    liveData.mockReset();
    liveData.mockResolvedValue(LIVE);
  });

  it('lists the member’s evaluations and their live figures, saying what was left out', async () => {
    mine.mockResolvedValue([
      {
        id: 'ev1',
        member: { id: 'm1', name: 'Pat' },
        evaluator: null,
        period_id: 'p1',
        period_name: '2025 Annual',
        period_start: '2025-01-01',
        period_end: '2025-12-31',
        template_name: 'Operational Annual',
        kind: 'annual',
        status: 'finalized',
        current_step: null,
        current_step_due: null,
        created_at: null,
      },
    ]);
    renderWithRouter(<MyEvaluationsPage />);
    expect(await screen.findByRole('link', { name: '2025 Annual' })).toHaveAttribute(
      'href',
      '/reports/evaluations/ev1'
    );
    expect(screen.getByText(/Complete/)).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('Call tracking is off for the department.')).toBeInTheDocument();
    expect(screen.getByText(/Left out: Leave of absence/)).toBeInTheDocument();
  });

  it('says when there are none yet', async () => {
    mine.mockResolvedValue([]);
    renderWithRouter(<MyEvaluationsPage />);
    expect(await screen.findByText('No evaluations yet')).toBeInTheDocument();
  });
});
