/**
 * Election Settings → Voter Eligibility: the department's default rules for
 * who may vote. Each control writes the whole `eligibility` object, a number
 * that is not yet valid is held in its box rather than sent, and the tier
 * rules are shown read-only beside them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { ElectionSettings, EligibilityDefaults } from '../types/election';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
    sendTestBallot: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionsSettingsPage } from './ElectionsSettingsPage';

const eligibility: EligibilityDefaults = {
  rules: { attendance: { mode: 'none' }, min_tenure_months: null },
  default_require_attendance: true,
  default_voter_types: ['all'],
  position_voter_types: { Chief: ['operational'] },
};

const stored: ElectionSettings = {
  proxy_voting_enabled: false,
  eligibility,
  tier_voting_rules: [
    {
      tier_id: 'probationary',
      name: 'Probationary',
      voting_eligible: false,
      requires_meeting_attendance: false,
      min_attendance_pct: 0,
      attendance_period_months: 12,
    },
    {
      tier_id: 'active',
      name: 'Active',
      voting_eligible: true,
      requires_meeting_attendance: true,
      min_attendance_pct: 50,
      attendance_period_months: 12,
    },
  ],
};

// The debounce (600ms) and the pill's minimum "Saving…" hold are real timers.
const SETTLE = { timeout: 4000 };

const lastSentEligibility = (): EligibilityDefaults => {
  const calls = mockUpdateSettings.mock.calls;
  const sent = calls[calls.length - 1]?.[0] as ElectionSettings | undefined;
  if (!sent?.eligibility) throw new Error('no eligibility was sent');
  return sent.eligibility;
};

describe('ElectionsSettingsPage — voter eligibility', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetElections.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockResolvedValue(structuredClone(stored));
    mockGetElections.mockResolvedValue([]);
    mockUpdateSettings.mockImplementation((data: unknown) => Promise.resolve(data));
    window.history.pushState({}, '', '/elections/settings?tab=eligibility');
  });

  it('opens on the section from ?tab=eligibility', async () => {
    renderWithRouter(<ElectionsSettingsPage />);
    expect(await screen.findByRole('heading', { name: 'Voter Eligibility' })).toBeInTheDocument();
    expect(screen.getByLabelText('Requirement')).toHaveValue('none');
  });

  it('saves an "N of the last M meetings" rule', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    await user.selectOptions(await screen.findByLabelText('Requirement'), 'count');
    expect(screen.getByLabelText('Meetings attended')).toHaveValue(6);
    expect(screen.getByLabelText('Out of the last')).toHaveValue(12);

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalled(), SETTLE);
    expect(lastSentEligibility().rules.attendance).toEqual({
      mode: 'count',
      min_meetings: 6,
      of_last_meetings: 12,
    });
    // Everything else in the defaults rides along unchanged.
    expect(lastSentEligibility().position_voter_types).toEqual({ Chief: ['operational'] });
  });

  it('holds a count above the look-back in its box instead of sending it', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue({
      ...structuredClone(stored),
      eligibility: {
        ...eligibility,
        rules: { attendance: { mode: 'count', min_meetings: 6, of_last_meetings: 12 }, min_tenure_months: null },
      },
    });
    renderWithRouter(<ElectionsSettingsPage />);

    const attended = await screen.findByLabelText('Meetings attended');
    await user.clear(attended);
    await user.type(attended, '13');

    expect(attended).toHaveValue(13);
    expect(attended).toHaveAttribute('aria-invalid', 'true');
    // One error for the pair, under the row, and the box it came from points at it.
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be more than the meetings looked back over');
    // Typing "13" passed through "1", a valid count that was saved on the way.
    expect(screen.getByRole('alert')).toHaveTextContent('The saved rule is still 1 of the last 12.');
    expect(attended).toHaveAccessibleDescription(/cannot be more than the meetings looked back over/);
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
    // "1" was valid on the way to "13" and may have been sent; "13" never is.
    for (const [sent] of mockUpdateSettings.mock.calls as [ElectionSettings][]) {
      expect(sent.eligibility?.rules.attendance.min_meetings).not.toBe(13);
    }

    // Raising the look-back makes the pair agree, and both are sent together.
    const lookBack = screen.getByLabelText('Out of the last');
    await user.clear(lookBack);
    await user.type(lookBack, '24');
    await waitFor(
      () => expect(lastSentEligibility().rules.attendance).toMatchObject({ min_meetings: 13, of_last_meetings: 24 }),
      SETTLE
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves the check-in default for new ballot items', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: 'Require voters to be checked in as present' }));
    await waitFor(() => expect(lastSentEligibility().default_require_attendance).toBe(false), SETTLE);
  });

  it('does not save a position list with a blank name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add position' }));
    // The stored Chief row, then the one just added.
    const [, addedRow] = screen.getAllByLabelText('Position');
    const added = addedRow as HTMLElement;
    expect(added).toHaveValue('');
    await user.type(added, 'x');
    await user.clear(added);

    expect(screen.getByRole('alert')).toHaveTextContent('Every position needs a name.');
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
    for (const [sent] of mockUpdateSettings.mock.calls as [ElectionSettings][]) {
      expect(Object.keys(sent.eligibility?.position_voter_types ?? {})).not.toContain('');
    }

    await user.type(added, 'Secretary');
    await waitFor(
      () =>
        expect(lastSentEligibility().position_voter_types).toEqual({
          Chief: ['operational'],
          Secretary: ['operational'],
        }),
      SETTLE
    );
  });

  it('shows each tier rule read-only', async () => {
    renderWithRouter(<ElectionsSettingsPage />);

    expect(await screen.findByText('50% of meetings over 12 months')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'membership tier settings' })).toHaveAttribute(
      'href',
      '/members/admin/settings/tiers'
    );
    expect(screen.getByRole('row', { name: /Probationary/ })).toHaveTextContent('No');
  });
});
