/**
 * Profile rules on the compliance editor (owner decisions 2026-11-21):
 * a requirement is required or optional, never both; a profile with no
 * required list keeps it unset across an unrelated save; and a priority that
 * ties with another active profile is warned about, never refused.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { nth, renderWithRouter } from '../test/utils';
import type { ComplianceConfigData, ComplianceProfile, AvailableRequirement } from '../types/training';

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
const mockUpdateConfig = vi.fn();
const mockInitializeConfig = vi.fn();
const mockGetAvailableRequirements = vi.fn();
const mockListReports = vi.fn();
const mockUpdateProfile = vi.fn();
const mockDeleteProfile = vi.fn();

vi.mock('../services/trainingServices', () => ({
  complianceConfigService: {
    getConfig: (...args: unknown[]) => mockGetConfig(...args) as unknown,
    updateConfig: (...args: unknown[]) => mockUpdateConfig(...args) as unknown,
    initializeConfig: (...args: unknown[]) => mockInitializeConfig(...args) as unknown,
    getAvailableRequirements: (...args: unknown[]) => mockGetAvailableRequirements(...args) as unknown,
    listReports: (...args: unknown[]) => mockListReports(...args) as unknown,
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args) as unknown,
    createProfile: vi.fn(),
    deleteProfile: (...args: unknown[]) => mockDeleteProfile(...args) as unknown,
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

const cpr: AvailableRequirement = {
  id: 'req-1',
  name: 'CPR Certification',
  requirement_type: 'certification',
  source: 'department',
  frequency: null,
};
const hazmat: AvailableRequirement = {
  id: 'req-2',
  name: 'Hazmat Awareness',
  requirement_type: 'hours',
  source: 'department',
  frequency: null,
};

function makeProfile(overrides: Partial<ComplianceProfile>): ComplianceProfile {
  return {
    id: 'profile-1',
    configId: 'config-1',
    name: 'Active Firefighter',
    membershipTypes: [],
    requiredRequirementIds: [],
    optionalRequirementIds: [],
    adminHoursRequirements: [],
    isActive: true,
    priority: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeConfig(profiles: ComplianceProfile[]): ComplianceConfigData {
  return {
    id: 'config-1',
    organizationId: 'org-1',
    thresholdType: 'percentage',
    compliantThreshold: 100,
    atRiskThreshold: 75,
    gracePeriodDays: 0,
    includeCurrentMonth: true,
    autoReportFrequency: 'monthly',
    reportEmailRecipients: [],
    reportDayOfMonth: 1,
    notifyNonCompliantMembers: false,
    notifyDaysBeforeDeadline: [],
    profiles,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

async function openEditForm(config: ComplianceConfigData, profileName: string) {
  window.history.pushState({}, '', '/training/compliance-config');
  renderWithRouter(<ComplianceRequirementsConfigPage />);
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'Compliance Settings' })).toBeInTheDocument();
  });
  await userEvent.click(screen.getByRole('button', { name: 'Profiles' }));
  const card = await screen.findByRole('article', { name: profileName });
  await userEvent.click(within(card).getByTitle('Edit'));
  await screen.findByRole('button', { name: 'Update Profile' });
  void config;
}

function resetMocks(config: ComplianceConfigData) {
  mockGetConfig.mockReset();
  mockGetConfig.mockResolvedValue(config);
  mockGetAvailableRequirements.mockReset();
  mockGetAvailableRequirements.mockResolvedValue({ requirements: [cpr, hazmat] });
  mockListReports.mockReset();
  mockListReports.mockResolvedValue({ reports: [], total: 0 });
  mockListCategories.mockReset();
  mockListCategories.mockResolvedValue([]);
  mockUpdateProfile.mockReset();
  mockUpdateProfile.mockResolvedValue(nth(config.profiles, 0));
}

describe('ComplianceRequirementsConfigPage — an id is required or optional, never both', () => {
  const config = makeConfig([makeProfile({})]);
  beforeEach(() => resetMocks(config));

  it('ticking a requirement Required takes it out of Optional', async () => {
    await openEditForm(config, 'Active Firefighter');

    // The required list comes first, then the optional one.
    const optionalBox = nth(screen.getAllByRole('checkbox', { name: /Hazmat Awareness/ }), 1);
    await userEvent.click(optionalBox);
    const requiredBox = nth(screen.getAllByRole('checkbox', { name: /Hazmat Awareness/ }), 0);
    await userEvent.click(requiredBox);

    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ required_requirement_ids: ['req-2'], optional_requirement_ids: [] })
    );
  });
});

describe('ComplianceRequirementsConfigPage — a profile with no required list set', () => {
  const config = makeConfig([makeProfile({ requiredRequirementIds: null, optionalRequirementIds: ['req-2'] })]);
  beforeEach(() => resetMocks(config));

  it('keeps the list unset when the officer saves an unrelated change', async () => {
    await openEditForm(config, 'Active Firefighter');
    expect(screen.getByText(/No required list is set/)).toBeInTheDocument();

    const name = screen.getByLabelText('Profile Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Line Firefighter');
    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    const [, payload] = mockUpdateProfile.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).not.toHaveProperty('required_requirement_ids');
    expect(payload).toMatchObject({ name: 'Line Firefighter', optional_requirement_ids: ['req-2'] });
  });

  it('sends the list once the officer ticks a required requirement', async () => {
    await openEditForm(config, 'Active Firefighter');

    await userEvent.click(nth(screen.getAllByRole('checkbox', { name: /CPR Certification/ }), 0));
    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledTimes(1));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      'profile-1',
      expect.objectContaining({ required_requirement_ids: ['req-1'] })
    );
  });
});

describe('ComplianceRequirementsConfigPage — equal priorities', () => {
  const older = makeProfile({ id: 'p-old', name: 'Engine Company', priority: 5, createdAt: '2026-03-03T12:00:00Z' });
  const editing = makeProfile({ id: 'p-new', name: 'Truck Company', priority: 2, createdAt: '2026-05-01T12:00:00Z' });
  const inactive = makeProfile({ id: 'p-off', name: 'Retired Group', priority: 7, isActive: false });
  const config = makeConfig([older, inactive, editing]);
  beforeEach(() => resetMocks(config));

  it('warns, naming the other active profile, when the typed priority ties', async () => {
    await openEditForm(config, 'Truck Company');
    expect(screen.queryByText(/also has priority/)).not.toBeInTheDocument();

    const priority = screen.getByLabelText('Priority');
    await userEvent.clear(priority);
    await userEvent.type(priority, '5');

    const warning = screen.getByText(/also has priority 5/);
    expect(warning).toHaveTextContent('Engine Company');
    expect(warning).toHaveTextContent(/graded by the profile created first/);
  });

  it('does not warn for an inactive profile at the same priority', async () => {
    await openEditForm(config, 'Truck Company');
    const priority = screen.getByLabelText('Priority');
    await userEvent.clear(priority);
    await userEvent.type(priority, '7');
    expect(screen.queryByText(/also has priority/)).not.toBeInTheDocument();
  });

  it('does not count the profile being edited against itself, and still saves a tie', async () => {
    await openEditForm(config, 'Engine Company');
    expect(screen.queryByText(/also has priority/)).not.toBeInTheDocument();

    const priority = screen.getByLabelText('Priority');
    await userEvent.clear(priority);
    await userEvent.type(priority, '2');
    expect(screen.getByText(/also has priority 2/)).toHaveTextContent('Truck Company');

    await userEvent.click(screen.getByRole('button', { name: 'Update Profile' }));
    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith('p-old', expect.objectContaining({ priority: 2 }))
    );
  });
});

describe('ComplianceRequirementsConfigPage — a stored tie is flagged on the profile list', () => {
  const a = makeProfile({ id: 'p-a', name: 'Engine Company', priority: 3 });
  const b = makeProfile({ id: 'p-b', name: 'Truck Company', priority: 3 });
  const c = makeProfile({ id: 'p-c', name: 'Rescue Company', priority: 9 });
  const config = makeConfig([a, b, c]);
  beforeEach(() => resetMocks(config));

  it('notes the tie on both tied cards and not on the others', async () => {
    window.history.pushState({}, '', '/training/compliance-config');
    renderWithRouter(<ComplianceRequirementsConfigPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Profiles' }));

    const cardOf = (name: string) => screen.findByRole('article', { name });
    expect(within(await cardOf('Engine Company')).getByText(/Same priority as/)).toHaveTextContent('Truck Company');
    expect(within(await cardOf('Truck Company')).getByText(/Same priority as/)).toHaveTextContent('Engine Company');
    expect(within(await cardOf('Rescue Company')).queryByText(/Same priority as/)).not.toBeInTheDocument();
  });
});
