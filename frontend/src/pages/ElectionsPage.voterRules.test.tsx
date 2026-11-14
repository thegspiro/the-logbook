/**
 * The create dialog shows the voter rules the server will copy onto the new
 * election from Election Settings, so the secretary knows what it starts with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockGetSettings = vi.fn();
const mockCreateElection = vi.fn();
const mockPreview = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    createElection: (...args: unknown[]) => mockCreateElection(...args) as unknown,
    previewElectorate: (...args: unknown[]) => mockPreview(...args) as unknown,
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

    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of vote'), 'annual');
    expect(panel).toHaveTextContent('Attended at least 3 of their last 4 meetings');
    expect(panel).toHaveTextContent('Administrative members may vote 12 months after becoming administrative');
  });
});

describe('ElectionsPage create dialog — per-type voter rules', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetSettings.mockReset();
    mockGetElections.mockResolvedValue([]);
  });

  const typeDefaults = (types: Record<string, unknown>) => ({
    rules: { version: 2, attendance: { mode: 'none' }, types },
    default_require_attendance: true,
    default_voter_types: ['all'],
    position_voter_types: {},
  });

  it("lists each member type's rules under the department's names", async () => {
    mockGetSettings.mockResolvedValue({
      eligibility: typeDefaults({ senior: { may_vote: false, wait: null, attendance: [] } }),
      voter_rows: [{ key: 'senior', label: 'Senior', decided_by: 'status', counts_as: 'regular' }],
    });
    const dialog = await openCreateDialog();
    const panel = within(dialog).getByTestId('create-voter-rules');
    await waitFor(() => expect(panel).toHaveTextContent('Senior members may not vote'));
  });

  it('shows the bylaws rules for a bylaws amendment', async () => {
    mockGetSettings.mockResolvedValue({
      eligibility: typeDefaults({ regular: { may_vote: true, wait: null, attendance: [] } }),
      bylaws_eligibility: typeDefaults({ probationary: { may_vote: false, wait: null, attendance: [] } }),
    });
    const dialog = await openCreateDialog();
    const panel = within(dialog).getByTestId('create-voter-rules');
    await waitFor(() => expect(panel).toHaveTextContent('No voter rules are set'));

    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of vote'), 'bylaws');
    expect(panel).toHaveTextContent('Probationary members may not vote');
  });
});

describe('ElectionsPage create dialog — an election outside the defaults', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetSettings.mockReset();
    mockCreateElection.mockReset();
    mockPreview.mockReset();
    mockGetElections.mockResolvedValue([]);
    mockCreateElection.mockResolvedValue({ id: 'e1' });
    mockPreview.mockResolvedValue({ eligible: 3, total: 4 });
    mockGetSettings.mockResolvedValue({
      eligibility: {
        rules: {
          version: 2,
          attendance: { mode: 'none' },
          types: { probationary: { may_vote: false, wait: null, attendance: [] } },
        },
        default_require_attendance: true,
        default_voter_types: ['all'],
        position_voter_types: {},
      },
      voter_rows: [{ key: 'probationary', label: 'Probationary', decided_by: 'status', counts_as: null }],
    });
  });

  it('sends the custom rules with the reason given', async () => {
    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Bylaws vote');
    fireEvent.change(within(dialog).getByLabelText(/Start Date & Time/, { selector: 'input' }), {
      target: { value: '2099-12-10' },
    });
    await userEvent.click(
      await within(dialog).findByRole('checkbox', { name: 'Customize the rules for this election' })
    );
    const probationary = within(dialog).getByRole('group', { name: 'Probationary members' });
    await userEvent.selectOptions(within(probationary).getByLabelText('May vote'), 'yes');
    await userEvent.type(within(dialog).getByLabelText(/Why do these rules differ/), ' Bylaws Article XII ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Election' }));

    await waitFor(() => expect(mockCreateElection).toHaveBeenCalledTimes(1));
    const [sent] = mockCreateElection.mock.calls[0] as [Record<string, unknown>];
    expect(sent.eligibility_rules).toEqual({
      version: 2,
      attendance: { mode: 'none' },
      types: { probationary: { may_vote: true, wait: null, attendance: [] } },
    });
    expect(sent.eligibility_override_reason).toBe('Bylaws Article XII');
  });

  it('sends no rules when the defaults are kept', async () => {
    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Title' }), 'Regular vote');
    fireEvent.change(within(dialog).getByLabelText(/Start Date & Time/, { selector: 'input' }), {
      target: { value: '2099-12-10' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Election' }));

    await waitFor(() => expect(mockCreateElection).toHaveBeenCalledTimes(1));
    const [sent] = mockCreateElection.mock.calls[0] as [Record<string, unknown>];
    expect(sent).not.toHaveProperty('eligibility_rules');
    expect(sent.eligibility_override_reason).toBeUndefined();
  });
});
