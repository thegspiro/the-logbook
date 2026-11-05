import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { DrillPreview, HistoricalImportDetail } from '../../../modules/integrations/types/historicalImport';

const mockPreview = vi.fn();
const mockSettings = vi.fn();
const mockCommit = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getDrillPreview: (...a: unknown[]) => mockPreview(...a) as unknown,
    updateTrainingSettings: (...a: unknown[]) => mockSettings(...a) as unknown,
    commitDrills: (...a: unknown[]) => mockCommit(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import DrillsSection from './DrillsSection';

const detail: HistoricalImportDetail = {
  import: {
    id: 'hist-1',
    status: 'routed',
    source_filename: 'FCVFDHours.csv',
    source_system: 'Hours database',
    timezone: 'America/New_York',
    row_count: 6,
  },
  headers: ['VID', 'Date', 'Training', 'TrainingSubject', 'CompanyDrill'],
  column_mapping: { membership_number: 'VID' },
  hour_columns: { Training: 'training' },
  call_columns: {},
  fields: ['membership_number'],
  record_types: ['shift', 'on_call', 'training', 'admin', 'ignore'],
  importable_types: ['shift', 'on_call', 'admin', 'training'],
  call_types: [],
  routing: { rows: 6, skipped: 0, with_errors: 0, errors: [], notes: {}, types: {} },
  rows_imported: 0,
  batches: [],
  settings_locked: false,
};

const preview = (overrides: Partial<DrillPreview> = {}): DrillPreview => ({
  settings: {
    subject_column: 'TrainingSubject',
    instructor_column: '',
    taught_column: '',
    provider_patterns: [],
    unmatched_provider_action: null,
    subject_courses: {},
    drill_column: 'CompanyDrill',
    drill_requirement_ids: [],
    drill_min_members: 3,
  },
  headers: detail.headers,
  drill_rows: 1240,
  drill_dates: 310,
  qualifying_dates: 212,
  qualifying_rows: 1105,
  sessions_created: 0,
  dates: [{ date: '2016-05-02', members: 3, session_created: false }],
  requirements: [
    { id: 'req-active', name: 'Company drills — active', required_attendance_pct: 60 },
    { id: 'req-senior', name: 'Company drills — senior', required_attendance_pct: 30 },
  ],
  training_committed: true,
  can_commit: false,
  result: null,
  ...overrides,
});

const openSection = async (section: HistoricalImportDetail = detail) => {
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <DrillsSection detail={section} />
    </ConfirmProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Set up drills' }));
  await screen.findByText(/dates have/);
  return user;
};

describe('DrillsSection', () => {
  beforeEach(() => {
    for (const mock of [mockPreview, mockSettings, mockCommit]) mock.mockReset();
    mockPreview.mockResolvedValue(preview());
    mockSettings.mockResolvedValue(undefined);
    mockCommit.mockResolvedValue(
      preview({
        sessions_created: 212,
        result: { sessions_created: 212, sessions_relinked: 0, records_attached: 1105 },
      })
    );
  });

  it('cannot be opened without a training column', () => {
    render(
      <ConfirmProvider>
        <DrillsSection detail={{ ...detail, hour_columns: {} }} />
      </ConfirmProvider>
    );
    expect(screen.getByRole('button', { name: 'Set up drills' })).toBeDisabled();
  });

  it('shows which dates count as held drills', async () => {
    await openSection();
    expect(mockPreview).toHaveBeenCalledWith('hist-1');
    expect(screen.getByText(/1,240 drill rows on 310 dates/)).toBeInTheDocument();
    expect(screen.getByText('212')).toBeInTheDocument();
    expect(screen.getByLabelText('Drill column')).toHaveValue('CompanyDrill');
    expect(screen.getByRole('button', { name: 'Create drills' })).toBeDisabled();
  });

  it('saves the requirements the drills count toward', async () => {
    mockPreview.mockResolvedValue(
      preview({ settings: { ...preview().settings, drill_requirement_ids: ['req-active'] } })
    );
    const user = await openSection();
    await user.click(screen.getByLabelText(/Company drills — senior/));

    await waitFor(() =>
      expect(mockSettings).toHaveBeenCalledWith('hist-1', { drill_requirement_ids: ['req-active', 'req-senior'] })
    );
  });

  it('saves the member threshold when the field is left', async () => {
    const user = await openSection();
    const field = screen.getByLabelText('Members needed');
    await user.clear(field);
    await user.type(field, '4');
    await user.tab();

    await waitFor(() => expect(mockSettings).toHaveBeenCalledWith('hist-1', { drill_min_members: 4 }));
  });

  it('asks for the training step first', async () => {
    mockPreview.mockResolvedValue(preview({ training_committed: false }));
    await openSection();
    expect(screen.getByText(/Import the training records \(step 5\) first/)).toBeInTheDocument();
  });

  it('creates the drills only after confirmation', async () => {
    mockPreview.mockResolvedValue(
      preview({ can_commit: true, settings: { ...preview().settings, drill_requirement_ids: ['req-active'] } })
    );
    const user = await openSection();
    await user.click(screen.getByRole('button', { name: 'Create drills' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('212 past, finalized drill sessions');
    await user.click(within(dialog).getByRole('button', { name: 'Create drills' }));

    await waitFor(() => expect(mockCommit).toHaveBeenCalledWith('hist-1'));
    expect(await screen.findByText(/212 drills created, 1,105 attendance records attached/)).toBeInTheDocument();
  });
});
