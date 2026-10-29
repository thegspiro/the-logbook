/**
 * The create dialog shows the voter rules the server will copy onto the new
 * election from Election Settings, so the secretary knows what it starts with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockGetSettings = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue({ meetings: [] }) },
  ranksService: { getRanks: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

async function openCreateDialog() {
  renderWithRouter(<ElectionsPage />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^Create Election$/ })).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole('button', { name: /^Create Election$/ }));
  return screen.getByRole('dialog');
}

describe('ElectionsPage create dialog — voter rules', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetSettings.mockReset();
    mockGetElections.mockResolvedValue([]);
  });

  it('lists the rules the new election will start with', async () => {
    mockGetSettings.mockResolvedValue({
      eligibility: {
        rules: {
          attendance: { mode: 'count', min_meetings: 6, of_last_meetings: 12 },
          waiting_periods: { administrative: { mode: 'months', months: 6 }, probationary: { mode: 'never' } },
        },
        default_require_attendance: true,
        default_voter_types: ['all'],
        position_voter_types: {},
      },
    });
    const dialog = await openCreateDialog();
    const panel = within(dialog).getByTestId('create-voter-rules');

    await waitFor(() => expect(panel).toHaveTextContent('Attended at least 6 of their last 12 meetings'));
    expect(panel).toHaveTextContent('Administrative members may vote 6 months after becoming administrative');
    expect(panel).toHaveTextContent('Probationary members may not vote');
  });

  it('says so when there are none', async () => {
    mockGetSettings.mockResolvedValue({});
    const dialog = await openCreateDialog();

    expect(within(dialog).getByTestId('create-voter-rules')).toHaveTextContent('No election-wide rules.');
  });

  it('shows the annual meeting rules when the election is held there', async () => {
    mockGetSettings.mockResolvedValue({
      eligibility: {
        rules: { attendance: { mode: 'none' }, waiting_periods: {} },
        default_require_attendance: true,
        default_voter_types: ['all'],
        position_voter_types: {},
      },
      annual_eligibility: {
        rules: {
          attendance: { mode: 'count', min_meetings: 3, of_last_meetings: 4 },
          waiting_periods: { administrative: { mode: 'months', months: 12 } },
        },
        default_require_attendance: true,
        default_voter_types: ['all'],
        position_voter_types: {},
      },
    });
    const dialog = await openCreateDialog();
    const panel = within(dialog).getByTestId('create-voter-rules');
    await waitFor(() => expect(panel).toHaveTextContent('No election-wide rules.'));

    await userEvent.selectOptions(within(dialog).getByLabelText('Held at'), 'annual');
    expect(panel).toHaveTextContent('Attended at least 3 of their last 4 meetings');
    expect(panel).toHaveTextContent('Administrative members may vote 12 months after becoming administrative');
  });
});
