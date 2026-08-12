import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ExternalTrainingPage from './ExternalTrainingPage';

const mockGetProviders = vi.fn();
const mockGetImportBatches = vi.fn();
const mockGetCategoryMappings = vi.fn();
const mockGetUserMappings = vi.fn();
const mockUpdateCategoryMapping = vi.fn();
const mockGetCategories = vi.fn();
const mockDeleteProvider = vi.fn();

vi.mock('../services/api', () => ({
  externalTrainingService: {
    getProviders: (...a: unknown[]) => mockGetProviders(...a) as unknown,
    getImportBatches: (...a: unknown[]) => mockGetImportBatches(...a) as unknown,
    getCategoryMappings: (...a: unknown[]) => mockGetCategoryMappings(...a) as unknown,
    getUserMappings: (...a: unknown[]) => mockGetUserMappings(...a) as unknown,
    updateCategoryMapping: (...a: unknown[]) => mockUpdateCategoryMapping(...a) as unknown,
    deleteProvider: (...a: unknown[]) => mockDeleteProvider(...a) as unknown,
  },
  trainingService: {
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
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
        internal_category_id: '',
        is_mapped: false,
      })
    );
  });
});
