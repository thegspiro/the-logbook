import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExternalTrainingImport, ExternalTrainingProvider, ExternalTrainingSyncLog } from '../../types/training';

const mockGetSyncLogs = vi.fn();
const mockGetUserMappings = vi.fn();
const mockGetImportedRecords = vi.fn();

vi.mock('../../services/api', () => ({
  externalTrainingService: {
    getSyncLogs: (...a: unknown[]) => mockGetSyncLogs(...a) as unknown,
    getUserMappings: (...a: unknown[]) => mockGetUserMappings(...a) as unknown,
    getImportedRecords: (...a: unknown[]) => mockGetImportedRecords(...a) as unknown,
  },
}));

import ExternalSyncHistoryPanel from './ExternalSyncHistoryPanel';

const provider = (id: string, name: string): ExternalTrainingProvider =>
  ({ id, name, provider_type: 'vector_solutions' }) as ExternalTrainingProvider;

const run = (overrides: Partial<ExternalTrainingSyncLog> = {}): ExternalTrainingSyncLog => ({
  id: 'run-1',
  provider_id: 'p1',
  organization_id: 'org',
  sync_type: 'incremental',
  status: 'completed',
  started_at: '2026-10-15T06:00:00Z',
  records_fetched: 3,
  records_imported: 2,
  records_updated: 0,
  records_skipped: 1,
  records_failed: 0,
  created_at: '2026-10-15T06:00:00Z',
  ...overrides,
});

const staged = (overrides: Partial<ExternalTrainingImport> = {}): ExternalTrainingImport => ({
  id: 'imp-1',
  provider_id: 'p1',
  organization_id: 'org',
  sync_log_id: 'run-1',
  external_record_id: 'R-1',
  external_user_id: 'ext-7',
  course_title: 'Hazmat Awareness',
  course_code: 'HZ-101',
  credit_hours: 2,
  completion_date: '2026-10-14T00:00:00Z',
  import_status: 'imported',
  created_at: '2026-10-15T06:00:00Z',
  updated_at: '2026-10-15T06:00:00Z',
  ...overrides,
});

describe('ExternalSyncHistoryPanel', () => {
  beforeEach(() => {
    mockGetSyncLogs.mockReset();
    mockGetUserMappings.mockReset();
    mockGetImportedRecords.mockReset();
    mockGetSyncLogs.mockResolvedValue([run()]);
    mockGetUserMappings.mockResolvedValue([
      { id: 'm1', provider_id: 'p1', external_user_id: 'ext-7', internal_user_name: 'Pat Member', is_mapped: true },
    ]);
    mockGetImportedRecords.mockResolvedValue([
      staged(),
      staged({ id: 'imp-2', external_user_id: 'ext-9', course_title: 'Ladder Operations' }),
    ]);
  });

  it("lists a provider's runs with their counts", async () => {
    render(<ExternalSyncHistoryPanel providers={[provider('p1', 'Vector Solutions')]} />);

    expect(await screen.findByText('Scheduled pull · Completed')).toBeInTheDocument();
    expect(screen.getByText(/3 fetched · 2 new · 0 updated · 1 skipped · 0 failed/)).toBeInTheDocument();
    expect(mockGetSyncLogs).toHaveBeenCalledWith('p1', 25);
  });

  it('shows the classes a run brought in, naming matched members', async () => {
    const user = userEvent.setup();
    render(<ExternalSyncHistoryPanel providers={[provider('p1', 'Vector Solutions')]} />);

    await user.click(await screen.findByRole('button', { name: 'Show classes' }));

    const table = await screen.findByRole('table');
    expect(mockGetImportedRecords).toHaveBeenCalledWith('p1', { sync_log_id: 'run-1', limit: 200 });
    expect(within(table).getByText('Hazmat Awareness')).toBeInTheDocument();
    expect(within(table).getByText('Pat Member')).toBeInTheDocument();
    // Not matched to a member yet: the provider's own id stands in.
    expect(within(table).getByText('ext-9')).toBeInTheDocument();
    expect(within(table).getAllByText('Added to records')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Hide classes' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says where classes went when a later run synced them again', async () => {
    mockGetImportedRecords.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ExternalSyncHistoryPanel providers={[provider('p1', 'Vector Solutions')]} />);

    await user.click(await screen.findByRole('button', { name: 'Show classes' }));

    expect(
      await screen.findByText('Every class from this run was synced again by a later run and is listed there.')
    ).toBeInTheDocument();
  });

  it('switches provider from the picker when there is more than one', async () => {
    const user = userEvent.setup();
    render(<ExternalSyncHistoryPanel providers={[provider('p1', 'Vector Solutions'), provider('p2', 'Lexipol')]} />);
    await screen.findByText('Scheduled pull · Completed');

    await user.selectOptions(screen.getByLabelText('Provider'), 'p2');

    expect(mockGetSyncLogs).toHaveBeenLastCalledWith('p2', 25);
    expect(mockGetUserMappings).toHaveBeenLastCalledWith('p2');
  });

  it('reports a history that failed to load instead of showing it as empty', async () => {
    mockGetSyncLogs.mockRejectedValue(new Error('Network down'));
    render(<ExternalSyncHistoryPanel providers={[provider('p1', 'Vector Solutions')]} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.queryByText('No syncs recorded')).not.toBeInTheDocument();
  });

  it('explains the tab before any provider is connected', () => {
    render(<ExternalSyncHistoryPanel providers={[]} />);

    expect(screen.getByText('No sync history yet')).toBeInTheDocument();
    expect(mockGetSyncLogs).not.toHaveBeenCalled();
  });
});
