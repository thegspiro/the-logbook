import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) as unknown, success: vi.fn() },
}));

const getMemberPeriodStatus = vi.fn();
vi.mock('../services/trainingServices', () => ({
  trainingService: {
    getMemberPeriodStatus: (...args: unknown[]) => getMemberPeriodStatus(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { renderWithRouter } from '../test/utils';
import MemberTrainingStatusPage from './MemberTrainingStatusPage';

describe('MemberTrainingStatusPage', () => {
  beforeEach(() => {
    mockToastError.mockReset();
    getMemberPeriodStatus.mockReset();
    getMemberPeriodStatus.mockResolvedValue({ members: [] });
  });

  // An empty roster reads as "nobody trained this period", so a 200 whose body
  // is not this shape (a captive portal's HTML page) must be reported as a
  // failed load. Reading it unchecked crashed the whole Training hub on
  // `rows is not iterable`.
  it.each([
    ['an HTML page', '<html>Sign in to Wi-Fi</html>'],
    ['an object without members', {}],
  ])('reports a failed load for %s instead of crashing', async (_label, body) => {
    getMemberPeriodStatus.mockResolvedValue(body);
    renderWithRouter(<MemberTrainingStatusPage />);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to load member training status'));
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('loads without an error for a well-formed empty period', async () => {
    renderWithRouter(<MemberTrainingStatusPage />);

    expect(await screen.findByText('No members to show')).toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  // Rendered bare inside the <tr>, the sort buttons all collapsed into one
  // anonymous cell above the first columns, so no heading sat over its data.
  it('renders one column header per data column', async () => {
    getMemberPeriodStatus.mockResolvedValue({
      members: [
        {
          user_id: 'u1',
          member_name: 'Adams, Laura',
          trainings_completed: 0,
          hours_completed: 0,
          last_activity: null,
          compliance_status: 'red',
          requirements_met: 0,
          requirements_total: 2,
        },
      ],
    });
    renderWithRouter(<MemberTrainingStatusPage />);

    await screen.findByText('Adams, Laura');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Member', 'Trainings', 'Hours', 'Last activity', 'Status']);
    const firstRow = screen.getAllByRole('row')[1];
    expect(firstRow).toBeDefined();
    expect(within(firstRow as HTMLElement).getAllByRole('cell')).toHaveLength(headers.length);
    expect(headers.every((h) => h.getAttribute('aria-sort') !== null)).toBe(true);
  });
});
