/**
 * The planning settings mirror, and what it says when it has not read anything.
 *
 * `getCachedShiftSettings()` falls back through localStorage to
 * `DEFAULT_SETTINGS`, so a failed load on a fresh browser renders the built-in
 * numbers in a card whose whole claim is "what a planned shift starts from".
 * That is the same defect this series has now found five times: an absent
 * answer presented as a confident one. Here it is worse than usual, because
 * every row links to the page that edits it — an officer following one would
 * find a value that does not match what they were just shown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../../test/utils';

const mockEnsureLoaded = vi.fn();
const mockGetCached = vi.fn();
vi.mock('../../../../modules/scheduling/services/shiftSettingsApi', () => ({
  ensureShiftSettingsLoaded: (...args: unknown[]) => mockEnsureLoaded(...args) as unknown,
  getCachedShiftSettings: (...args: unknown[]) => mockGetCached(...args) as unknown,
}));

const mockGetFeatureSettings = vi.fn();
vi.mock('../../../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getFeatureSettings: (...args: unknown[]) => mockGetFeatureSettings(...args) as unknown,
  },
}));

import PlanningSettingsSummary from './PlanningSettingsSummary';

// What `getCachedShiftSettings` hands back when nothing has ever been loaded:
// the built-in defaults, which look exactly like a configured department.
const DEFAULTS = {
  defaultDurationHours: 12,
  defaultMinStaffing: 4,
  overtimeThresholdHoursPerWeek: 48,
  apparatusTypeDefaults: {},
};

const FEATURE = { auto_generate_enabled: true, auto_generate_weeks: 4 };

describe('PlanningSettingsSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCached.mockReturnValue(DEFAULTS);
    mockEnsureLoaded.mockResolvedValue({ ...DEFAULTS, defaultDurationHours: 24 });
    mockGetFeatureSettings.mockResolvedValue(FEATURE);
  });

  it('shows the department’s own values when they load', async () => {
    renderWithRouter(<PlanningSettingsSummary />);

    expect(await screen.findByText('24 hours')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the values may be defaults when the settings did not load', async () => {
    mockEnsureLoaded.mockRejectedValue(new Error('boom'));

    renderWithRouter(<PlanningSettingsSummary />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/may be the built-in defaults/);
  });

  it('warns when only the feature settings fail, since a row reads them', async () => {
    mockGetFeatureSettings.mockRejectedValue(new Error('boom'));

    renderWithRouter(<PlanningSettingsSummary />);

    // The Automatic generation row falls to an em dash, which is honest on its
    // own — but silent. Nothing else on screen said a request had failed, so a
    // transient failure was indistinguishable from a department that has not
    // configured it.
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not load/);
  });

  it('retries, and drops the warning once the values arrive', async () => {
    let fail = true;
    mockEnsureLoaded.mockImplementation(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve({ ...DEFAULTS, defaultDurationHours: 24 })
    );
    const user = userEvent.setup();
    renderWithRouter(<PlanningSettingsSummary />);
    await screen.findByRole('alert');
    fail = false;

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('24 hours')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
