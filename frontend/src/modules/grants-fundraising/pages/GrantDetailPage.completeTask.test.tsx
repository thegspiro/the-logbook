/**
 * "Mark Complete" on a compliance task sends `completedDate` as the
 * department's local calendar date. The backend field is a `date`, so the
 * full ISO timestamp the page used to send was rejected with a 422 every time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Los_Angeles' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: () => true }),
}));

const updateComplianceTask = vi.fn();
vi.mock('../store/grantsStore', () => ({
  useGrantsStore: () => ({
    currentApplication: {
      id: 'app-1',
      grantProgramName: 'AFG',
      grantAgency: 'FEMA',
      applicationStatus: 'active',
      amountRequested: '1000',
      amountAwarded: '1000',
      matchAmount: null,
      priority: 'medium',
      budgetItems: [],
      expenditures: [],
      complianceTasks: [
        {
          id: 'task-1',
          applicationId: 'app-1',
          taskType: 'progress_update',
          title: 'Quarterly report',
          description: null,
          dueDate: '2026-04-01',
          completedDate: null,
          status: 'pending',
          priority: 'medium',
          assignedTo: null,
        },
      ],
      grantNotes: [],
    },
    isLoading: false,
    error: null,
    fetchApplication: () => Promise.resolve(),
    addBudgetItem: vi.fn(),
    addExpenditure: vi.fn(),
    addComplianceTask: vi.fn(),
    updateComplianceTask,
    addGrantNote: vi.fn(),
  }),
}));

import GrantDetailPage from './GrantDetailPage';

describe('GrantDetailPage mark compliance task complete', () => {
  beforeEach(() => {
    updateComplianceTask.mockReset();
    updateComplianceTask.mockResolvedValue(undefined);
    // 03:00 UTC on the 15th is still the 14th in Los Angeles.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T03:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the local calendar date, not a timestamp', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/grants/applications/app-1']}>
        <Routes>
          <Route path="/grants/applications/:id" element={<GrantDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /Compliance & Follow-Up/ }));
    await user.click(screen.getByRole('button', { name: /Mark Complete/ }));

    expect(updateComplianceTask).toHaveBeenCalledWith('app-1', 'task-1', {
      status: 'completed',
      completedDate: '2026-03-14',
    });
  });
});
