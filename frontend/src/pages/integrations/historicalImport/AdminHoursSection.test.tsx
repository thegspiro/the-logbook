import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { AdminPreview, HistoricalImportDetail } from '../../../modules/integrations/types/historicalImport';

const mockPreview = vi.fn();
const mockSettings = vi.fn();
const mockMembers = vi.fn();
const mockCommit = vi.fn();
const mockCreateCategory = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getAdminPreview: (...a: unknown[]) => mockPreview(...a) as unknown,
    updateAdminSettings: (...a: unknown[]) => mockSettings(...a) as unknown,
    updateMembers: (...a: unknown[]) => mockMembers(...a) as unknown,
    commitAdmin: (...a: unknown[]) => mockCommit(...a) as unknown,
  },
}));

vi.mock('../../../modules/admin-hours/services/api', () => ({
  adminHoursCategoryService: { create: (...a: unknown[]) => mockCreateCategory(...a) as unknown },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import AdminHoursSection from './AdminHoursSection';

const detail: HistoricalImportDetail = {
  import: {
    id: 'hist-1',
    status: 'draft',
    source_filename: 'FCVFDHours.csv',
    source_system: 'Hours database',
    timezone: 'America/New_York',
    row_count: 4,
  },
  headers: ['VID', 'Admin', 'PubEd', 'AdminActivity', 'OperationSanta', 'BDParty'],
  column_mapping: { membership_number: 'VID' },
  hour_columns: { Admin: 'admin', PubEd: 'admin' },
  call_columns: {},
  fields: ['membership_number'],
  record_types: ['shift', 'on_call', 'training', 'admin', 'ignore'],
  importable_types: ['shift', 'on_call', 'admin'],
  call_types: [],
  routing: { rows: 4, skipped: 0, with_errors: 0, errors: [], notes: {}, types: {} },
  rows_imported: 0,
  batches: [],
  settings_locked: false,
};

const preview = (overrides: Partial<AdminPreview> = {}): AdminPreview => ({
  settings: {
    description_columns: ['AdminActivity'],
    flag_categories: [
      { column: 'BDParty', category_id: 'cat-outreach' },
      { column: 'OperationSanta', category_id: 'cat-santa' },
    ],
    default_categories: { Admin: 'cat-admin', PubEd: 'cat-outreach' },
  },
  categories: [
    { id: 'cat-admin', name: 'Administrative Work', is_active: true },
    { id: 'cat-outreach', name: 'Community Outreach', is_active: true },
    { id: 'cat-santa', name: 'SantaMobile', is_active: true },
  ],
  pending_records: 36105,
  already_imported: 0,
  by_category: [{ category_id: 'cat-admin', name: 'Administrative Work', records: 22626, hours: 48706.5 }],
  uncategorized: 0,
  flag_conflicts: 34,
  problems: [],
  problem_count: 0,
  members: [],
  member_options: [{ id: 'u-1', name: 'Alice Ng', membership_number: '101', status: 'active' }],
  can_commit: true,
  result: null,
  ...overrides,
});

const openSection = async () => {
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <AdminHoursSection detail={detail} />
    </ConfirmProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Set up administrative hours' }));
  await screen.findByText(/36,105 entries to import/);
  return user;
};

describe('AdminHoursSection', () => {
  beforeEach(() => {
    for (const mock of [mockPreview, mockSettings, mockMembers, mockCommit, mockCreateCategory]) mock.mockReset();
    mockPreview.mockResolvedValue(preview());
    mockSettings.mockImplementation(() => Promise.resolve(preview()));
    mockMembers.mockImplementation(() => Promise.resolve(preview()));
    mockCommit.mockResolvedValue(preview({ result: { entries_created: 36105, members_created: 0 } }));
    mockCreateCategory.mockResolvedValue({ id: 'cat-new', name: 'SantaMobile' });
  });

  it('loads the preview only when opened', async () => {
    render(
      <ConfirmProvider>
        <AdminHoursSection detail={detail} />
      </ConfirmProvider>
    );
    expect(mockPreview).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Set up administrative hours' }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('hist-1'));
    expect(await screen.findByText(/34 rows have more than one set/)).toBeInTheDocument();
  });

  it('reorders flag rules, since the first set flag wins', async () => {
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Move OperationSanta up' }));
    await user.click(screen.getByRole('button', { name: 'Save rules' }));

    await waitFor(() =>
      expect(mockSettings).toHaveBeenCalledWith('hist-1', {
        description_columns: ['AdminActivity'],
        flag_categories: [
          { column: 'OperationSanta', category_id: 'cat-santa' },
          { column: 'BDParty', category_id: 'cat-outreach' },
        ],
        default_categories: { Admin: 'cat-admin', PubEd: 'cat-outreach' },
      })
    );
  });

  it('creates every unmatched member as archived in one step', async () => {
    mockPreview.mockResolvedValue(
      preview({
        can_commit: false,
        members: [
          {
            key: 'number:6178',
            display_name: '',
            membership_number: '6178',
            status: 'unmatched',
            reason: '',
            candidate_ids: [],
            new_first_name: '',
            new_last_name: '',
            row_count: 12,
          },
        ],
      })
    );
    const user = await openSection();
    expect(screen.getByRole('button', { name: 'Import administrative hours' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Create all unmatched as archived' }));

    expect(mockMembers).toHaveBeenCalledWith('hist-1', { 'number:6178': { action: 'create' } });
  });

  it('creates a missing category', async () => {
    const user = await openSection();
    await user.type(screen.getByLabelText('New Admin Hours category'), 'SantaMobile');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(mockCreateCategory).toHaveBeenCalledWith({ name: 'SantaMobile' }));
  });

  it('imports only after confirmation', async () => {
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Import administrative hours' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('36,105 approved Admin Hours entries');
    await user.click(within(dialog).getByRole('button', { name: 'Import entries' }));

    await waitFor(() => expect(mockCommit).toHaveBeenCalledWith('hist-1'));
    expect(await screen.findByText(/Imported 36,105 entries/)).toBeInTheDocument();
  });
});
