/**
 * A compliance profile can be scoped to members holding a position, AND'd with
 * its membership types. The backend has matched `role_ids` against a member's
 * positions all along (`_find_matching_profile`), but this page offered no way
 * to set them, so a department could not tell a Life member who still rides
 * from one who let their certifications lapse: both are membership type
 * "life", and only a position distinguishes them without touching the
 * member's class — which election eligibility reads.
 *
 * These render the real page and assert the request body the mocked service
 * received.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { AvailablePosition, ComplianceConfigData, ComplianceProfile } from '../types/training';

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
const mockGetAvailablePositions = vi.fn();
const mockListReports = vi.fn();
const mockUpdateProfile = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    updateConfig: vi.fn(),
    initializeConfig: vi.fn(),
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    getAvailablePositions: (...args: unknown[]) => mockGetAvailablePositions(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) as unknown,
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    generateReport: vi.fn(),
    deleteReport: vi.fn(),
    emailReport: vi.fn(),
  },
}));

const mockListCategories = vi.fn();

vi.mock('../modules/admin-hours/services/api', () => ({
  adminHoursCategoryService: {
    list: (...args: unknown[]) => mockListCategories(...args) as unknown,
  },
}));

import ComplianceRequirementsConfigPage from './ComplianceRequirementsConfigPage';

const nonOperational: AvailablePosition = { id: 'pos-nonop', name: 'Life Member - Non-Operational' };
const driver: AvailablePosition = { id: 'pos-driver', name: 'Driver' };

const profile: ComplianceProfile = {
  id: 'profile-1',
  configId: 'config-1',
  name: 'Non-operational life members',
  membershipTypes: ['life'],
  roleIds: [],
  requiredRequirementIds: [],
  optionalRequirementIds: [],
  adminHoursRequirements: [],
  isActive: true,
  priority: 10,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function configWith(p: ComplianceProfile): ComplianceConfigData {
  return {
    id: 'config-1',
    organizationId: 'org-1',
    thresholdType: 'percentage',
    compliantThreshold: 100,
    atRiskThreshold: 75,
    gracePeriodDays: 0,
    includeCurrentMonth: true,
    autoReportFrequency: 'none',
    reportEmailRecipients: null,
    reportDayOfMonth: 1,
    notifyNonCompliantMembers: false,
    notifyDaysBeforeDeadline: null,
    profiles: [p],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

async function openProfiles() {
  // The tab is read from the URL and jsdom's history is not reset between tests.
  window.history.pushState({}, '', '/training/compliance-config?tab=profiles');
  renderWithRouter(<ComplianceRequirementsConfigPage />);
  await screen.findByText('Non-operational life members');
}

async function openEditForm() {
  await openProfiles();
  await userEvent.click(screen.getByTitle('Edit'));
  await screen.findByRole('button', { name: 'Update Profile' });
}

function positionGroup() {
  return screen.getByRole('group', { name: 'Applies to Members Holding a Position' });
}

describe('ComplianceRequirementsConfigPage — scoping a profile by position', () => {
  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetConfig.mockResolvedValue(configWith(profile));
    mockGetAvailableRequirements.mockReset();
    mockGetAvailableRequirements.mockResolvedValue({ requirements: [] });
    mockGetAvailablePositions.mockReset();
    mockGetAvailablePositions.mockResolvedValue({ positions: [driver, nonOperational] });
    mockListReports.mockReset();
    mockListReports.mockResolvedValue({ reports: [], total: 0 });
    mockListCategories.mockReset();
    mockListCategories.mockResolvedValue([]);
    mockUpdateProfile.mockReset();
    mockUpdateProfile.mockResolvedValue(profile);
  });

  it('sends the checked position ids as role_ids', async () => {
    await openEditForm();

    await userEvent.click(within(positionGroup()).getByRole('checkbox', { name: 'Life Member - Non-Operational' }));
    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ membership_types: ['life'], role_ids: ['pos-nonop'] })
    );
  });

  it('sends an empty list when the last position is unchecked, so the clear persists', async () => {
    mockGetConfig.mockResolvedValue(configWith({ ...profile, roleIds: ['pos-nonop'] }));
    await openEditForm();

    const checkbox = within(positionGroup()).getByRole('checkbox', { name: 'Life Member - Non-Operational' });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith('profile-1', expect.objectContaining({ role_ids: [] }));
  });

  it('names the positions on the profile card', async () => {
    mockGetConfig.mockResolvedValue(configWith({ ...profile, roleIds: ['pos-nonop'] }));
    await openProfiles();

    expect(await screen.findByText('Positions: Life Member - Non-Operational')).toBeInTheDocument();
  });

  it('keeps a since-deleted position removable rather than hiding it', async () => {
    mockGetConfig.mockResolvedValue(configWith({ ...profile, roleIds: ['pos-gone'] }));
    await openEditForm();

    const stale = within(positionGroup()).getByRole('checkbox', { name: 'Deleted position' });
    expect(stale).toBeChecked();
    await userEvent.click(stale);
    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith('profile-1', expect.objectContaining({ role_ids: [] }));
  });
});
