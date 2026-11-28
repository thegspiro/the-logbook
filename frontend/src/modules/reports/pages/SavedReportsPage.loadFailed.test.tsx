/**
 * A saved-reports list that failed to load says so and offers a retry. It
 * used to show "No saved reports yet", telling a department its saved and
 * scheduled reports were gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let canManage = true;
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => (p === 'reports.manage' ? canManage : true) }),
}));

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigate };
});

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const runNow = vi.fn();
const getAvailable = vi.fn();
vi.mock('../services/api', () => ({
  reportsApiService: {
    getAvailableReports: (...a: unknown[]) => getAvailable(...a) as unknown,
    generateReport: vi.fn(),
  },
  savedReportsService: {
    list: (...a: unknown[]) => list(...a) as unknown,
    create: (...a: unknown[]) => create(...a) as unknown,
    update: (...a: unknown[]) => update(...a) as unknown,
    delete: (...a: unknown[]) => remove(...a) as unknown,
    runNow: (...a: unknown[]) => runNow(...a) as unknown,
  },
}));

import SavedReportsPage from './SavedReportsPage';
import { useReportsStore } from '../store/reportsStore';

describe('SavedReportsPage when the list cannot be loaded', () => {
  beforeEach(() => {
    canManage = true;
    for (const m of [list, create, update, remove, runNow, getAvailable, navigate]) m.mockReset();
    getAvailable.mockResolvedValue({ available_reports: [] });
    list.mockRejectedValue(new Error('Service unavailable'));
    useReportsStore.setState({
      savedReports: [],
      availableReports: [],
      error: null,
      savedReportsError: null,
      generatingReportType: null,
    });
  });

  it('says so, with a retry, instead of reading as an empty list', async () => {
    renderWithRouter(<SavedReportsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load saved reports');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No saved reports yet')).not.toBeInTheDocument();
  });
});
