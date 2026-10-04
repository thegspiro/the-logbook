import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

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
});
