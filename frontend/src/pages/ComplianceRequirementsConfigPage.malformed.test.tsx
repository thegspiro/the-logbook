/**
 * A 200 whose body is not what the endpoint declares — a captive portal's HTML
 * page on station Wi-Fi — must not reach the screen as data.
 *
 * `getConfig` returning `null` is a department that has never saved a config,
 * and the built-in defaults apply. A truthy body that is not a config used to
 * be read field by field, which filled every setting with `undefined`: the
 * Status Preview read "Compliant: ≥ undefined%" and the Profiles tab crashed on
 * `config.profiles.map`. The requirements and report lists were stored the
 * same way, unchecked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../test/utils';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean; user: { timezone?: string } }) => unknown) =>
    selector({ checkPermission: () => true, user: { timezone: 'UTC' } }),
}));

const mockGetConfig = vi.fn();
const mockGetAvailableRequirements = vi.fn();
const mockListReports = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    updateConfig: vi.fn(),
    initializeConfig: vi.fn(),
    updateProfile: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    generateReport: vi.fn(),
    deleteReport: vi.fn(),
    emailReport: vi.fn(),
  },
}));

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursCategoryService: { list: () => Promise.resolve([]) },
}));

import ComplianceRequirementsConfigPage from './ComplianceRequirementsConfigPage';

const PORTAL_PAGE = '<html>Sign in to Wi-Fi</html>';

async function renderLoaded() {
  // The tab is read from the URL, and jsdom's history is not reset between
  // tests, so a tab one test opened would otherwise be the next one's start.
  window.history.pushState({}, '', '/training/compliance-config');
  renderWithRouter(<ComplianceRequirementsConfigPage />);
  await screen.findByText('Compliance Requirements Configuration');
}

describe('ComplianceRequirementsConfigPage — a response that is not its declared shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(null);
    mockGetAvailableRequirements.mockReset();
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [] });
    mockListReports.mockReset();
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
  });

  it('keeps the built-in defaults, without an error, for a department with no saved config', async () => {
    await renderLoaded();

    expect(await screen.findByText('Compliant: ≥ 100%')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ['an HTML page', PORTAL_PAGE],
    ['an empty object', {}],
    ['a config without profiles', { compliantThreshold: 90 }],
  ])('reports a failed load for %s instead of filling the form with undefined', async (_label, body) => {
    mockGetConfig.mockResolvedValue(body);
    await renderLoaded();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load compliance configuration'));
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
    expect(screen.getByText('Compliant: ≥ 100%')).toBeInTheDocument();
  });

  it('opens Profiles and Report History when their lists come back malformed', async () => {
    mockGetConfig.mockResolvedValue({});
    mockGetAvailableRequirements.mockResolvedValue({ requirements: PORTAL_PAGE });
    mockListReports.mockResolvedValue({ reports: PORTAL_PAGE });
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole('button', { name: 'Profiles' }));
    await user.click(screen.getByRole('button', { name: 'Report History' }));
    expect(await screen.findByRole('heading', { name: 'Report History (0)' })).toBeInTheDocument();
  });
});
