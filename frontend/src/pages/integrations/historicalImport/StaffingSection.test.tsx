import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type {
  HistoricalImportDetail,
  StaffingFile,
  StaffingPreview,
} from '../../../modules/integrations/types/historicalImport';

const mockGet = vi.fn();
const mockUpload = vi.fn();
const mockMapping = vi.fn();
const mockRemove = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getStaffing: (...a: unknown[]) => mockGet(...a) as unknown,
    uploadStaffingFile: (...a: unknown[]) => mockUpload(...a) as unknown,
    updateStaffingMapping: (...a: unknown[]) => mockMapping(...a) as unknown,
    removeStaffingFile: (...a: unknown[]) => mockRemove(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import StaffingSection from './StaffingSection';

const detail: HistoricalImportDetail = {
  import: {
    id: 'hist-1',
    status: 'routed',
    source_filename: 'FCVFDHours.csv',
    source_system: 'Hours database',
    timezone: 'America/New_York',
    row_count: 5,
  },
  headers: ['VID', 'Date'],
  column_mapping: { membership_number: 'VID' },
  hour_columns: {},
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

const FIELDS = {
  seats: ['event_key', 'seat_id', 'title', 'membership_number', 'member_name'],
  events: ['event_key', 'date', 'activity'],
};

const seatsFile: StaffingFile = {
  kind: 'seats',
  source_filename: 'Staffing.csv',
  headers: ['EventID', 'PositionID', 'Title', 'VID', 'Name'],
  column_mapping: { event_key: 'EventID', title: 'Title', membership_number: 'VID', member_name: 'Name' },
  row_count: 36213,
};

const eventsFile: StaffingFile = {
  kind: 'events',
  source_filename: 'Events.csv',
  headers: ['EventID', 'eDate', 'Activity'],
  column_mapping: { event_key: 'EventID', date: 'eDate', activity: 'Activity' },
  row_count: 13185,
};

const empty: StaffingPreview = {
  files: [],
  fields: FIELDS,
  flat_file: false,
  problems: ['Upload the seats file: one row per seat, naming who held it.'],
  summary: null,
};

const joined: StaffingPreview = {
  files: [seatsFile, eventsFile],
  fields: FIELDS,
  flat_file: false,
  problems: [],
  summary: {
    seats: {
      rows: 36213,
      filled: 20733,
      unfilled: 15480,
      without_event_key: 4,
      missing_event: 12659,
      missing_event_filled: 7124,
      missing_event_keys: 2547,
      missing_event_examples: [{ event_key: '55582345', seats: 65 }],
    },
    events: {
      rows: 13185,
      staffed: 5633,
      unstaffed: 7552,
      unstaffed_importable: 7551,
      undated: 0,
      undated_examples: [],
      usual_first_year: 2000,
      usual_last_year: 2027,
      outside_usual_range: 1,
      outside_usual_range_examples: [
        { line_number: 8485, date: '1931-12-12', activity: 'Watch Night EMS Standby', seats: 4 },
      ],
      upcoming: 98,
      overnight: 3509,
      duplicate_keys: 0,
      first_date: '2000-10-01',
      last_date: '2027-03-28',
    },
  },
};

const openSection = async () => {
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <StaffingSection detail={detail} />
    </ConfirmProvider>
  );
  await user.click(screen.getByRole('button', { name: 'Set up staffing' }));
  return user;
};

describe('StaffingSection', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockUpload, mockMapping, mockRemove]) mock.mockReset();
    mockGet.mockResolvedValue(joined);
    mockUpload.mockResolvedValue(joined);
    mockMapping.mockResolvedValue(joined);
    mockRemove.mockResolvedValue(empty);
  });

  it('asks for the files when none is stored', async () => {
    mockGet.mockResolvedValue(empty);
    await openSection();
    expect(await screen.findByText(/Upload the seats file/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('hist-1');
    expect(screen.getByText(/Drop the seats file here/)).toBeInTheDocument();
    expect(screen.getByText(/Drop the events file here/)).toBeInTheDocument();
  });

  it('uploads a file as the kind its drop zone names', async () => {
    mockGet.mockResolvedValue(empty);
    await openSection();
    const zone = await screen.findByRole('button', { name: 'Drop the events file here or click to browse' });
    const file = new File(['EventID,eDate\n1,2016-05-02'], 'Events.csv', { type: 'text/csv' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith('hist-1', 'events', file));
  });

  it('shows how the files join', async () => {
    await openSection();
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('36,213 seats: 20,733 filled, 15,480 unfilled');
    expect(status).toHaveTextContent(
      '7,552 without. Of those, 7,551 have a date in the usual range and become calendar events.'
    );
    expect(status).toHaveTextContent('12,659 seats (7,124 filled) name 2,547 events the events file does not have');
    expect(status).toHaveTextContent('55582345 (65 seats)');
    expect(status).toHaveTextContent('1 events fall outside 2000–2027');
    expect(status).toHaveTextContent('Watch Night EMS Standby');
    expect(status).toHaveTextContent('98 upcoming events become scheduled events');
  });

  it('saves the whole mapping when a column changes', async () => {
    const user = await openSection();
    await user.selectOptions(
      await screen.findByLabelText('Seat number', { selector: '#staffing-seats-seat_id' }),
      'PositionID'
    );

    await waitFor(() =>
      expect(mockMapping).toHaveBeenCalledWith('hist-1', 'seats', {
        event_key: 'EventID',
        title: 'Title',
        membership_number: 'VID',
        member_name: 'Name',
        seat_id: 'PositionID',
      })
    );
  });

  it('unmaps a field set to not in this file', async () => {
    const user = await openSection();
    await user.selectOptions(await screen.findByLabelText('Activity'), 'Not in this file');

    await waitFor(() =>
      expect(mockMapping).toHaveBeenCalledWith('hist-1', 'events', {
        event_key: 'EventID',
        date: 'eDate',
        activity: null,
      })
    );
  });

  it('removes a file only after confirmation', async () => {
    const user = await openSection();
    await screen.findByRole('status');
    const [removeSeats] = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(removeSeats as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove file' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('hist-1', 'seats'));
  });
});
