import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();

// The quick-duration helpers must do their arithmetic in the department's
// zone, not the browser's, so the test needs the two to differ. Pick an org
// zone that is not the one the runner happens to be in.
const { ORG_TZ } = vi.hoisted(() => {
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { ORG_TZ: browser === 'Asia/Tokyo' ? 'America/New_York' : 'Asia/Tokyo' };
});

vi.mock('../services/api', () => ({
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElectionSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: { getRanks: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => ORG_TZ }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

/**
 * The end picker: its date input, and the hour / minute / AM-PM selects. Both
 * pickers on the form announce "Time hour" etc., so the selects are taken by
 * position — the start picker renders first.
 */
function endPicker() {
  return {
    dateInput: screen.getByLabelText(/End Date & Time/),
    hour: screen.getAllByLabelText(/hour$/)[1],
    minute: screen.getAllByLabelText(/minute$/)[1],
    period: screen.getAllByLabelText(/AM\/PM$/)[1],
  };
}

async function openCreateDialogWithStart() {
  mockGetElections.mockResolvedValue([]);
  renderWithRouter(<ElectionsPage />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^Create Election$/ })).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole('button', { name: /^Create Election$/ }));
  // Picking a date with no time yet gives a 09:00 start in the department zone.
  const startDate = screen.getByLabelText(/Start Date & Time/);
  fireEvent.change(startDate, { target: { value: '2026-10-01' } });
  expect(startDate).toHaveValue('2026-10-01');
}

describe('ElectionsPage quick-duration helpers use the department timezone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults the end to 11:59 PM of the start day in the department zone', async () => {
    await openCreateDialogWithStart();

    const end = endPicker();
    expect(end.dateInput).toHaveValue('2026-10-01');
    expect(end.hour).toHaveValue('11');
    expect(end.minute).toHaveValue('59');
    expect(end.period).toHaveValue('PM');
  });

  it('"1 Hour" ends one hour after a 9:00 AM start, on the same day', async () => {
    await openCreateDialogWithStart();

    await userEvent.click(screen.getByRole('button', { name: /^1 Hour$/ }));

    const end = endPicker();
    expect(end.dateInput).toHaveValue('2026-10-01');
    expect(end.hour).toHaveValue('10');
    expect(end.minute).toHaveValue('00');
    expect(end.period).toHaveValue('AM');
  });

  it('"End of Day" ends at 11:59 PM of the start day in the department zone', async () => {
    await openCreateDialogWithStart();

    await userEvent.click(screen.getByRole('button', { name: /^End of Day/ }));

    const end = endPicker();
    expect(end.dateInput).toHaveValue('2026-10-01');
    expect(end.hour).toHaveValue('11');
    expect(end.minute).toHaveValue('59');
    expect(end.period).toHaveValue('PM');
  });
});
