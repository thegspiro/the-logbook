/**
 * W50-46 — every switch on the Election Settings page prints its name beside
 * the control, not only in `aria-label`, so a sighted member can tell the
 * five toggles apart.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
    sendTestBallot: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionsSettingsPage } from './ElectionsSettingsPage';

const FEATURE_SWITCHES = [
  ['Nomination phase', 'Members nominate candidates (with accept/decline) before the ballot opens.'],
  ['Paper-ballot entry', 'Officers record in-room paper tallies into the results.'],
  ['Non-voter reminders', 'Manual and automatic reminder emails with fresh ballot links.'],
  ['Scheduled opening', 'Elections flagged "open automatically" open themselves at their start time.'],
] as const;

describe('ElectionsSettingsPage — visible switch labels (W50-46)', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetElections.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockResolvedValue({ proxy_voting_enabled: false });
    mockGetElections.mockResolvedValue([]);
    mockUpdateSettings.mockImplementation((data: unknown) => Promise.resolve(data));
  });

  it('prints the proxy switch name and description beside the switch', async () => {
    window.history.pushState({}, '', '/elections/settings');
    renderWithRouter(<ElectionsSettingsPage />);

    const toggle = await screen.findByRole('switch', { name: 'Allow proxy voting' });
    expect(screen.getByText('Allow proxy voting')).toBeVisible();
    expect(
      screen.getByText('A secretary can authorize one member to vote on behalf of another absent member.')
    ).toBeVisible();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it.each(FEATURE_SWITCHES)('prints "%s" beside its switch on the Features section', async (name, description) => {
    window.history.pushState({}, '', '/elections/settings?tab=features');
    renderWithRouter(<ElectionsSettingsPage />);

    const toggle = await screen.findByRole('switch', { name });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The name is on screen as text, not only as the switch's aria-label.
    expect(screen.getByText(name)).toBeVisible();
    expect(screen.getByText(description)).toBeVisible();
  });

  it('gives every switch on the Features section a visible name', async () => {
    window.history.pushState({}, '', '/elections/settings?tab=features');
    renderWithRouter(<ElectionsSettingsPage />);

    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(FEATURE_SWITCHES.length);
    for (const control of switches) {
      const name = control.getAttribute('aria-label') ?? '';
      expect(name).not.toBe('');
      expect(screen.getByText(name)).toBeVisible();
    }
  });
});
