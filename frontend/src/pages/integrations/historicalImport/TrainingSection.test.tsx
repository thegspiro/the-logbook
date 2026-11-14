import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { HistoricalImportDetail, TrainingPreview } from '../../../modules/integrations/types/historicalImport';

const mockPreview = vi.fn();
const mockSettings = vi.fn();
const mockAccept = vi.fn();
const mockCommit = vi.fn();
const mockMembers = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getTrainingPreview: (...a: unknown[]) => mockPreview(...a) as unknown,
    updateTrainingSettings: (...a: unknown[]) => mockSettings(...a) as unknown,
    acceptSuggestedCourses: (...a: unknown[]) => mockAccept(...a) as unknown,
    commitTraining: (...a: unknown[]) => mockCommit(...a) as unknown,
    updateMembers: (...a: unknown[]) => mockMembers(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import TrainingSection from './TrainingSection';

const detail: HistoricalImportDetail = {
  import: {
    id: 'hist-1',
    status: 'routed',
    source_filename: 'FCVFDHours.csv',
    source_system: 'Hours database',
    timezone: 'America/New_York',
    row_count: 5,
  },
  headers: ['VID', 'Training', 'TrainingSubject', 'TrainingInstructor', 'Instructor'],
  column_mapping: { membership_number: 'VID' },
  hour_columns: { Training: 'training' },
  call_columns: {},
  fields: ['membership_number'],
  record_types: ['shift', 'on_call', 'training', 'admin', 'ignore'],
  importable_types: ['shift', 'on_call', 'admin', 'training'],
  call_types: [],
  routing: { rows: 5, skipped: 0, with_errors: 0, errors: [], notes: {}, types: {} },
  rows_imported: 0,
  batches: [],
  settings_locked: false,
};

const preview = (overrides: Partial<TrainingPreview> = {}): TrainingPreview => ({
  settings: {
    subject_column: 'TrainingSubject',
    instructor_column: 'TrainingInstructor',
    taught_column: 'Instructor',
    provider_patterns: ['targetsolution', 'vector'],
    unmatched_provider_action: null,
    subject_courses: {},
  },
  headers: detail.headers,
  pending_records: 29610,
  already_imported: 0,
  provider_rows: 1573,
  provider_matched: 11,
  provider_unmatched: 1562,
  subject_count: 12124,
  subjects_mapped: 0,
  records_mapped: 0,
  subjects: [
    {
      key: 'emt b',
      subject: 'EMT-B',
      records: 450,
      hours: 1800,
      course_id: null,
      course_name: '',
      suggested_course_id: 'c-emt',
    },
  ],
  subject_total: 1,
  courses: [{ id: 'c-emt', name: 'EMT-B', training_type: 'certification' }],
  problems: [],
  problem_count: 0,
  members: [],
  member_options: [],
  can_commit: false,
  result: null,
  ...overrides,
});

const openSection = async () => {
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <TrainingSection detail={detail} />
    </ConfirmProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Set up training' }));
  await screen.findByText(/29,610 records to import/);
  return user;
};

describe('TrainingSection', () => {
  beforeEach(() => {
    for (const mock of [mockPreview, mockSettings, mockAccept, mockCommit, mockMembers]) mock.mockReset();
    mockPreview.mockResolvedValue(preview());
    mockSettings.mockResolvedValue(preview());
    mockAccept.mockResolvedValue(9);
    mockCommit.mockResolvedValue(preview({ result: { records_created: 29610 } }));
  });

  it('loads the first page of subjects when opened', async () => {
    await openSection();
    expect(mockPreview).toHaveBeenCalledWith('hist-1', { search: '', offset: 0, limit: 25 });
    expect(screen.getByText(/1,562 match nothing synced/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import training records' })).toBeDisabled();
  });

  it('asks what to do with provider rows nothing synced matches', async () => {
    const user = await openSection();
    await user.click(screen.getByLabelText(/Leave them out/));

    await waitFor(() => expect(mockSettings).toHaveBeenCalledWith('hist-1', { unmatched_provider_action: 'skip' }));
  });

  it('maps a subject to its suggested course', async () => {
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Use EMT-B' }));

    await waitFor(() => expect(mockSettings).toHaveBeenCalledWith('hist-1', { subject_courses: { 'emt b': 'c-emt' } }));
  });

  it('puts a subject back to as written', async () => {
    mockPreview.mockResolvedValue(
      preview({
        subjects: [
          {
            key: 'emt b',
            subject: 'EMT-B',
            records: 450,
            hours: 1800,
            course_id: 'c-emt',
            course_name: 'EMT-B',
            suggested_course_id: 'c-emt',
          },
        ],
      })
    );
    const user = await openSection();
    await user.selectOptions(screen.getByLabelText('Course for EMT-B'), 'Import as written');

    await waitFor(() => expect(mockSettings).toHaveBeenCalledWith('hist-1', { subject_courses: { 'emt b': null } }));
  });

  it('accepts every suggestion at once', async () => {
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Accept all suggestions' }));

    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith('hist-1'));
  });

  it('imports only after confirmation', async () => {
    mockPreview.mockResolvedValue(
      preview({
        can_commit: true,
        settings: { ...preview().settings, unmatched_provider_action: 'import' },
      })
    );
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Import training records' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('29,610 completed training records');
    await user.click(within(dialog).getByRole('button', { name: 'Import records' }));

    await waitFor(() => expect(mockCommit).toHaveBeenCalledWith('hist-1'));
    expect(await screen.findByText(/Imported 29,610 training records/)).toBeInTheDocument();
  });
});
