import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ExternalTrainingPage from './ExternalTrainingPage';

const mockGetProviders = vi.fn();
const mockGetImportBatches = vi.fn();
const mockGetCategoryMappings = vi.fn();
const mockGetUserMappings = vi.fn();
const mockUpdateCategoryMapping = vi.fn();
const mockGetCategories = vi.fn();
const mockUpdateUserMapping = vi.fn();
const mockGetUsers = vi.fn();
const mockDeleteProvider = vi.fn();
const mockCreateProvider = vi.fn();
const mockUpdateProvider = vi.fn();

vi.mock('../services/api', () => ({
  externalTrainingService: {
    getProviders: (...a: unknown[]) => mockGetProviders(...a) as unknown,
    getImportBatches: (...a: unknown[]) => mockGetImportBatches(...a) as unknown,
    getCategoryMappings: (...a: unknown[]) => mockGetCategoryMappings(...a) as unknown,
    getUserMappings: (...a: unknown[]) => mockGetUserMappings(...a) as unknown,
    updateCategoryMapping: (...a: unknown[]) => mockUpdateCategoryMapping(...a) as unknown,
    updateUserMapping: (...a: unknown[]) => mockUpdateUserMapping(...a) as unknown,
    deleteProvider: (...a: unknown[]) => mockDeleteProvider(...a) as unknown,
    createProvider: (...a: unknown[]) => mockCreateProvider(...a) as unknown,
    updateProvider: (...a: unknown[]) => mockUpdateProvider(...a) as unknown,
  },
  trainingService: {
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
  },
  userService: {
    getUsers: (...a: unknown[]) => mockGetUsers(...a) as unknown,
  },
}));

const provider = {
  id: 'prov-1',
  organization_id: 'org-1',
  name: 'Vector Solutions',
  provider_type: 'vector_solutions',
  is_active: true,
  auto_sync_enabled: false,
  sync_interval_hours: 24,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const unmapped = {
  id: 'map-1',
  provider_id: 'prov-1',
  organization_id: 'org-1',
  external_category_id: 'VS-114',
  external_category_name: 'Hazardous Materials Awareness',
  is_mapped: false,
  auto_mapped: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProviders.mockResolvedValue([provider]);
  mockGetImportBatches.mockResolvedValue([]);
  mockGetCategoryMappings.mockResolvedValue([unmapped]);
  mockGetUserMappings.mockResolvedValue([]);
  mockGetUsers.mockResolvedValue([]);
  mockGetCategories.mockResolvedValue([
    { id: 'cat-1', organization_id: 'org-1', name: 'Hazmat', sort_order: 0, active: true },
    { id: 'cat-2', organization_id: 'org-1', name: 'Fireground Operations', sort_order: 1, active: true },
  ]);
  mockUpdateCategoryMapping.mockImplementation((_p: string, _m: string, updates: Record<string, unknown>) =>
    Promise.resolve({ ...unmapped, ...updates, is_mapped: true })
  );
});

const openMappings = async () => {
  renderWithRouter(<ExternalTrainingPage />);
  await userEvent.click(await screen.findByRole('button', { name: /^Mappings$/ }));
};

describe('ExternalTrainingPage — category mappings', () => {
  // The Map Category button carried no handler at all: an officer clicked it,
  // nothing happened, and the only way to map a category was the API.
  it('offers the internal categories an external one can be pointed at', async () => {
    await openMappings();

    const select = await screen.findByLabelText('Internal category for Hazardous Materials Awareness');
    expect(select).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Fireground Operations' })).toBeInTheDocument();
  });

  it('saves the mapping the officer picks', async () => {
    await openMappings();

    const select = await screen.findByLabelText('Internal category for Hazardous Materials Awareness');
    await userEvent.selectOptions(select, 'cat-1');

    await waitFor(() =>
      expect(mockUpdateCategoryMapping).toHaveBeenCalledWith('prov-1', 'map-1', {
        internal_category_id: 'cat-1',
        is_mapped: true,
      })
    );
  });

  it('treats clearing the selection as unmapping, not as a mapping to nothing', async () => {
    mockGetCategoryMappings.mockResolvedValue([{ ...unmapped, is_mapped: true, internal_category_id: 'cat-1' }]);
    await openMappings();

    const select = await screen.findByLabelText('Internal category for Hazardous Materials Awareness');
    await userEvent.selectOptions(select, '');

    await waitFor(() =>
      expect(mockUpdateCategoryMapping).toHaveBeenCalledWith('prov-1', 'map-1', {
        internal_category_id: null,
        is_mapped: false,
      })
    );
  });
});

const unmappedUser = {
  id: 'umap-1',
  provider_id: 'prov-1',
  organization_id: 'org-1',
  external_user_id: 'EXT-42',
  external_name: 'Pat Rivera',
  external_email: 'privera@personal.test',
  is_mapped: false,
  auto_mapped: false,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const roster = [
  {
    id: 'user-1',
    organization_id: 'org-1',
    username: 'privera',
    first_name: 'Pat',
    last_name: 'Rivera',
    membership_number: '114',
    status: 'active',
  },
  { id: 'user-2', organization_id: 'org-1', username: 'jdoe', first_name: 'Jane', last_name: 'Doe', status: 'active' },
];

describe('ExternalTrainingPage — user mappings', () => {
  // The Map User button carried no handler at all: an officer clicked it,
  // nothing happened, and a provider user whose email matched nobody could
  // only be mapped through the API.
  beforeEach(() => {
    mockGetUserMappings.mockReset();
    mockGetUserMappings.mockResolvedValue([unmappedUser]);
    mockGetUsers.mockReset();
    mockGetUsers.mockResolvedValue(roster);
    mockUpdateUserMapping.mockReset();
    mockUpdateUserMapping.mockImplementation((_p: string, _m: string, updates: { internal_user_id: string | null }) =>
      Promise.resolve({
        ...unmappedUser,
        internal_user_id: updates.internal_user_id ?? undefined,
        is_mapped: updates.internal_user_id !== null,
        internal_user_name: updates.internal_user_id ? 'Pat Rivera' : undefined,
      })
    );
  });

  const openUsersTab = async () => {
    await openMappings();
    await userEvent.click(await screen.findByRole('tab', { name: /Users/ }));
  };

  it('offers the members an external user can be pointed at', async () => {
    await openUsersTab();

    expect(await screen.findByLabelText('Member for Pat Rivera')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pat Rivera (#114)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map User' })).not.toBeInTheDocument();
  });

  it('saves the member the officer picks', async () => {
    await openUsersTab();

    await userEvent.selectOptions(await screen.findByLabelText('Member for Pat Rivera'), 'user-1');

    await waitFor(() =>
      expect(mockUpdateUserMapping).toHaveBeenCalledWith('prov-1', 'umap-1', { internal_user_id: 'user-1' })
    );
  });

  it('sends an explicit null to unmap, which the endpoint reads as "clear"', async () => {
    mockGetUserMappings.mockResolvedValue([{ ...unmappedUser, is_mapped: true, internal_user_id: 'user-1' }]);
    await openUsersTab();

    await userEvent.selectOptions(await screen.findByLabelText('Member for Pat Rivera'), '');

    await waitFor(() =>
      expect(mockUpdateUserMapping).toHaveBeenCalledWith('prov-1', 'umap-1', { internal_user_id: null })
    );
  });

  it('keeps showing a mapped member the roster no longer lists', async () => {
    mockGetUserMappings.mockResolvedValue([
      { ...unmappedUser, is_mapped: true, internal_user_id: 'user-gone', internal_user_name: 'Sam Former' },
    ]);
    await openUsersTab();

    const select = await screen.findByLabelText('Member for Pat Rivera');
    expect(select).toHaveValue('user-gone');
    expect(screen.getByRole('option', { name: 'Sam Former' })).toBeInTheDocument();
  });
});

describe('ExternalTrainingPage — modal behavior', () => {
  it('only activates dialog behavior when a modal is open', async () => {
    renderWithRouter(<ExternalTrainingPage />);

    await screen.findByRole('button', { name: /^Mappings$/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');

    const addProvider = screen.getByRole('button', { name: /add provider/i });
    await userEvent.click(addProvider);

    expect(await screen.findByRole('dialog', { name: 'Select Provider Type' })).toBeInTheDocument();
    await waitFor(() => expect(addProvider).not.toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('ExternalTrainingPage — provider setup form', () => {
  const chooseProvider = async (label: RegExp) => {
    renderWithRouter(<ExternalTrainingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.click(await screen.findByRole('button', { name: label }));
  };

  // Target Solutions' Training Records API authenticates with a key and a
  // secret in the report URL. The form offered no secret field for it, so a
  // provider created from it could never authenticate.
  it('collects a required key and secret for Target Solutions, without a Site ID', async () => {
    await chooseProvider(/^Target Solutions/);

    expect(await screen.findByLabelText(/^API Key/)).toBeRequired();
    expect(screen.getByLabelText(/^API Secret/)).toBeRequired();
    expect(screen.queryByLabelText(/^Site ID/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication Type')).not.toBeInTheDocument();
  });

  it('keeps the AccessToken and Site ID fields for Vector Solutions', async () => {
    await chooseProvider(/^Vector Solutions/);

    expect(await screen.findByLabelText(/^Site ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^AccessToken/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^API Secret/)).not.toBeInTheDocument();
  });

  it('keeps the generic API key fields for other providers', async () => {
    await chooseProvider(/^Lexipol/);

    expect(await screen.findByLabelText('Authentication Type')).toBeInTheDocument();
    expect(screen.getByLabelText(/^API Key/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Site ID/)).not.toBeInTheDocument();
  });
});

describe('ExternalTrainingPage — hourly pulls with a daily review', () => {
  beforeEach(() => {
    mockCreateProvider.mockReset();
    mockCreateProvider.mockResolvedValue({ ...provider, id: 'prov-new' });
    mockUpdateProvider.mockReset();
    mockUpdateProvider.mockResolvedValue(provider);
  });

  it('defaults Target Solutions to hourly pulls and a 02:00 review', async () => {
    renderWithRouter(<ExternalTrainingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Target Solutions/ }));

    await userEvent.type(screen.getByLabelText(/^API Base URL/), 'https://app.targetsolutions.com/tsapp/api/');
    await userEvent.type(screen.getByLabelText(/^API Key/), 'k');
    await userEvent.type(screen.getByLabelText(/^API Secret/), 's');
    await userEvent.click(screen.getByRole('switch', { name: 'Enable auto-sync' }));

    expect(screen.getByLabelText('Pull new completions')).toHaveValue('1');
    expect(screen.getByLabelText('Daily 30-day review at')).toHaveValue('02:00');

    await userEvent.click(screen.getByRole('button', { name: 'Create Provider' }));

    await waitFor(() => expect(mockCreateProvider).toHaveBeenCalledTimes(1));
    const payload = mockCreateProvider.mock.calls[0]?.[0] as {
      sync_interval_hours?: number;
      config?: { review_time?: string | null };
    };
    expect(payload.sync_interval_hours).toBe(1);
    expect(payload.config?.review_time).toBe('02:00');
  });

  it('offers no review time for other providers', async () => {
    renderWithRouter(<ExternalTrainingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Vector Solutions/ }));
    await userEvent.click(screen.getByRole('switch', { name: 'Enable auto-sync' }));

    expect(screen.getByLabelText('Sync Interval')).toHaveValue('24');
    expect(screen.queryByLabelText('Daily 30-day review at')).not.toBeInTheDocument();
  });

  // The update endpoint replaces the stored config, so changing the review
  // time must carry the provider's existing settings along with it.
  it('keeps the existing config when an edit changes the review time', async () => {
    mockGetProviders.mockResolvedValue([
      {
        ...provider,
        provider_type: 'target_solutions',
        api_base_url: 'https://app.targetsolutions.com/tsapp/api/',
        auto_sync_enabled: true,
        sync_interval_hours: 1,
        config: { date_format: 'mm-dd-yyyy' },
      },
    ]);
    renderWithRouter(<ExternalTrainingPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit provider' }));

    // jsdom's time input does not take typed keystrokes like a browser does.
    fireEvent.change(await screen.findByLabelText('Daily 30-day review at'), { target: { value: '03:30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateProvider).toHaveBeenCalledTimes(1));
    expect(mockUpdateProvider).toHaveBeenCalledWith(
      'prov-1',
      expect.objectContaining({ config: { date_format: 'mm-dd-yyyy', review_time: '03:30' } })
    );
  });

  it('labels the schedule with its review time', async () => {
    mockGetProviders.mockResolvedValue([
      {
        ...provider,
        provider_type: 'target_solutions',
        auto_sync_enabled: true,
        sync_interval_hours: 1,
        config: { review_time: '02:00' },
      },
    ]);
    renderWithRouter(<ExternalTrainingPage />);

    expect(await screen.findByText('Every 1h · review daily at 02:00')).toBeInTheDocument();
  });
});
