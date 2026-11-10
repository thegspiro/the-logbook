import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { StaffingCommitPreview, StaffingUnfilledView } from '../../../modules/integrations/types/historicalImport';

const mockPreview = vi.fn();
const mockUnfilled = vi.fn();
const mockAssign = vi.fn();
const mockMembers = vi.fn();
const mockOption = vi.fn();
const mockCommit = vi.fn();

vi.mock('../../../modules/integrations/services/historicalImportApi', () => ({
  historicalImportService: {
    getStaffingCommit: (...a: unknown[]) => mockPreview(...a) as unknown,
    getStaffingUnfilled: (...a: unknown[]) => mockUnfilled(...a) as unknown,
    assignStaffingUnfilled: (...a: unknown[]) => mockAssign(...a) as unknown,
    updateStaffingMembers: (...a: unknown[]) => mockMembers(...a) as unknown,
    setStaffingIncludeUnstaffed: (...a: unknown[]) => mockOption(...a) as unknown,
    commitStaffing: (...a: unknown[]) => mockCommit(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import StaffingCommitPanel from './StaffingCommitPanel';

const options = [{ id: 'u-1', name: 'Alice Ng', membership_number: '101', status: 'active' }];

const preview = (overrides: Partial<StaffingCommitPreview> = {}): StaffingCommitPreview => ({
  counts: {
    shifts: 2294,
    shift_seats: 3413,
    events: 9517,
    upcoming_events: 15,
    check_ins: 1035,
    outreach_seats: 94,
    assigned_unfilled: 0,
  },
  skipped: { no_event: 12663, title_undecided: 15876, unfilled: 3128, activity_left_out: 0 },
  unfilled_seats: 3128,
  include_unstaffed: true,
  members: [],
  member_options: options,
  can_commit: true,
  result: null,
  ...overrides,
});

const unfilled: StaffingUnfilledView = {
  items: [
    {
      line_number: 4,
      date: '2016-05-02',
      activity: 'LA106 Day Staff',
      title: 'Technician',
      maps_to: 'Firefighter',
      required: false,
      assigned_user_id: null,
    },
  ],
  total: 1,
  assigned: 0,
  member_options: options,
};

describe('StaffingCommitPanel', () => {
  beforeEach(() => {
    for (const mock of [mockPreview, mockUnfilled, mockAssign, mockMembers, mockOption, mockCommit]) {
      mock.mockReset();
    }
    mockPreview.mockResolvedValue(preview());
    mockUnfilled.mockResolvedValue(unfilled);
    mockAssign.mockResolvedValue({ ...unfilled, assigned: 1 });
    mockMembers.mockResolvedValue(preview());
    mockOption.mockResolvedValue(preview({ include_unstaffed: false }));
    mockCommit.mockResolvedValue(
      preview({ result: { shifts_filled: 12, seats_added: 3238, events_created: 9517, already_imported: 0 } })
    );
  });

  it('says what would be written and what is left out', async () => {
    renderWithRouter(<StaffingCommitPanel importId="hist-1" />);
    expect(await screen.findByText(/3,413 crew seats on 2,294 shifts/)).toBeInTheDocument();
    expect(
      screen.getByText(/9,517 calendar events \(15 upcoming\), 1,035 check-ins and 94 outreach roles/)
    ).toBeInTheDocument();
    expect(screen.getByText('12,663 seats name an event the export does not have')).toBeInTheDocument();
    expect(screen.getByText('3,128 seats are unfilled with nobody assigned')).toBeInTheDocument();
    expect(screen.queryByText(/activity you left out/)).not.toBeInTheDocument();
    expect(mockUnfilled).toHaveBeenCalledWith('hist-1', { offset: 0, limit: 25 });
  });

  it('assigns a member to an unfilled seat', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingCommitPanel importId="hist-1" />);
    await user.selectOptions(await screen.findByLabelText('Technician → Firefighter'), 'u-1');

    await waitFor(() => expect(mockAssign).toHaveBeenCalledWith('hist-1', { '4': 'u-1' }, { offset: 0, limit: 25 }));
  });

  it('can leave events with no seats off the calendar', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingCommitPanel importId="hist-1" />);
    await user.click(await screen.findByLabelText('Add events with no seats to the calendar too'));

    await waitFor(() => expect(mockOption).toHaveBeenCalledWith('hist-1', false));
  });

  it('waits for the members to be decided', async () => {
    mockPreview.mockResolvedValue(
      preview({
        can_commit: false,
        members: [
          {
            key: 'number:999',
            display_name: 'Zed Quinn',
            membership_number: '999',
            status: 'unmatched',
            reason: '',
            candidate_ids: [],
            new_first_name: '',
            new_last_name: '',
            row_count: 3,
          },
        ],
      })
    );
    renderWithRouter(<StaffingCommitPanel importId="hist-1" />);
    expect(await screen.findByText(/Members \(1 to decide\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write the roster' })).toBeDisabled();
  });

  it('writes the roster only after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<StaffingCommitPanel importId="hist-1" />);
    await user.click(await screen.findByRole('button', { name: 'Write the roster' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('No hours are credited');
    await user.click(within(dialog).getByRole('button', { name: 'Write the roster' }));

    await waitFor(() => expect(mockCommit).toHaveBeenCalledWith('hist-1'));
    expect(
      await screen.findByText(/12 existing shifts filled, 3,238 crew seats added, 9,517 calendar events created/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write again' })).toBeInTheDocument();
  });
});
