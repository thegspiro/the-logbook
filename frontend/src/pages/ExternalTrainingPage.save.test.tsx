/**
 * Training forms batch E: the provider dialogs follow the owner's form rule
 * (2026-11-05, docs/KNOWN_LIMITATIONS.md "Forms — Save With an Error").
 *
 * A new provider is created only once every field is fixed, each refusal on
 * its field. An edit saves the rest and leaves a refused field out of the
 * update, so its stored value is kept and the field stays flagged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ExternalTrainingPage from './ExternalTrainingPage';

const mockGetProviders = vi.fn();
const mockGetImportBatches = vi.fn();
const mockGetImportedRecords = vi.fn();
const mockGetCategoryMappings = vi.fn();
const mockGetUserMappings = vi.fn();
const mockUpdateCategoryMapping = vi.fn();
const mockGetCategories = vi.fn();
const mockUpdateUserMapping = vi.fn();
const mockGetUsers = vi.fn();
const mockDeleteProvider = vi.fn();
const mockCreateProvider = vi.fn();
const mockUpdateProvider = vi.fn();
const mockUploadReport = vi.fn();
const mockGetCourseMappings = vi.fn();
const mockUpdateCourseMapping = vi.fn();
const mockGetCourses = vi.fn();
const mockImportMatched = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  externalTrainingService: {
    getProviders: (...a: unknown[]) => mockGetProviders(...a) as unknown,
    getImportBatches: (...a: unknown[]) => mockGetImportBatches(...a) as unknown,
    getImportedRecords: (...a: unknown[]) => mockGetImportedRecords(...a) as unknown,
    getCategoryMappings: (...a: unknown[]) => mockGetCategoryMappings(...a) as unknown,
    getUserMappings: (...a: unknown[]) => mockGetUserMappings(...a) as unknown,
    importMatched: (...a: unknown[]) => mockImportMatched(...a) as unknown,
    updateCategoryMapping: (...a: unknown[]) => mockUpdateCategoryMapping(...a) as unknown,
    updateUserMapping: (...a: unknown[]) => mockUpdateUserMapping(...a) as unknown,
    deleteProvider: (...a: unknown[]) => mockDeleteProvider(...a) as unknown,
    createProvider: (...a: unknown[]) => mockCreateProvider(...a) as unknown,
    updateProvider: (...a: unknown[]) => mockUpdateProvider(...a) as unknown,
    uploadReport: (...a: unknown[]) => mockUploadReport(...a) as unknown,
    getCourseMappings: (...a: unknown[]) => mockGetCourseMappings(...a) as unknown,
    updateCourseMapping: (...a: unknown[]) => mockUpdateCourseMapping(...a) as unknown,
  },
  trainingService: {
    getCategories: (...a: unknown[]) => mockGetCategories(...a) as unknown,
    getCourses: (...a: unknown[]) => mockGetCourses(...a) as unknown,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetProviders.mockReset();
  mockGetProviders.mockResolvedValue([
    { ...provider, api_base_url: 'https://vs.example.com/api', description: 'Main account' },
  ]);
  mockGetImportBatches.mockResolvedValue([]);
  mockGetImportedRecords.mockResolvedValue([]);
  mockGetCategoryMappings.mockResolvedValue([]);
  mockGetUserMappings.mockResolvedValue([]);
  mockGetUsers.mockResolvedValue([]);
  mockGetCategories.mockResolvedValue([]);
  mockGetCourseMappings.mockResolvedValue([]);
  mockGetCourses.mockResolvedValue([]);
  mockCreateProvider.mockReset();
  mockCreateProvider.mockResolvedValue({ ...provider, id: 'prov-new' });
  mockUpdateProvider.mockReset();
  mockUpdateProvider.mockResolvedValue(provider);
});

const unprocessable = (field: string, msg: string) =>
  Object.assign(new Error('422'), {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['body', field], msg, type: 'value_error' }] } },
  });

const openEdit = async () => {
  renderWithRouter(<ExternalTrainingPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Edit provider' }));
  return screen.findByLabelText(/^Display Name/);
};

describe('ExternalTrainingPage provider dialogs save with an error (batch E)', () => {
  it('creates nothing without an API address, and says so on that field', async () => {
    renderWithRouter(<ExternalTrainingPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Lexipol/ }));
    await userEvent.type(screen.getByLabelText(/^API Key/), 'k');

    const create = screen.getByRole('button', { name: 'Create Provider' });
    expect(create).toBeEnabled();
    await userEvent.click(create);

    const url = screen.getByLabelText(/^API Base URL/);
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription('Enter the API address.');
    expect(mockCreateProvider).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit with a blank name, and keeps the name flagged', async () => {
    const name = await openEdit();
    await userEvent.clear(name);
    await userEvent.clear(screen.getByLabelText('Description'));
    await userEvent.type(screen.getByLabelText('Description'), 'Second account');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateProvider).toHaveBeenCalledTimes(1));
    const [, body] = mockUpdateProvider.mock.calls[0] as [string, Record<string, unknown>];
    expect(body).not.toHaveProperty('name');
    expect(body).toMatchObject({ description: 'Second account', api_base_url: 'https://vs.example.com/api' });
    expect(await screen.findByLabelText(/^Display Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Provider saved, except display name/)).toBeInTheDocument();
  });

  it('resends an edit without a field the server refuses, and flags that field', async () => {
    mockUpdateProvider.mockRejectedValueOnce(unprocessable('api_base_url', 'Value error, no credentials in the URL'));
    await openEdit();
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateProvider).toHaveBeenCalledTimes(2));
    const [, second] = mockUpdateProvider.mock.calls[1] as [string, Record<string, unknown>];
    expect(second).not.toHaveProperty('api_base_url');
    expect(second).toHaveProperty('name', 'Vector Solutions');
    expect(await screen.findByLabelText(/^API Base URL/)).toHaveAccessibleDescription(
      'Value error, no credentials in the URL.'
    );
  });

  // An update reads an omitted key as "leave alone", so a cleared description
  // used to report success and keep the old text.
  it('sends a cleared description as null, so the clear is saved', async () => {
    await openEdit();
    await userEvent.clear(screen.getByLabelText('Description'));
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateProvider).toHaveBeenCalledTimes(1));
    expect(mockUpdateProvider).toHaveBeenCalledWith('prov-1', expect.objectContaining({ description: null }));
  });
});
