import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();
const mockSuggest = vi.fn();
const mockRecalc = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    updateMinutes: (...a: unknown[]) => mockUpdate(...a) as unknown,
    getAttendanceSuggestions: (...a: unknown[]) => mockSuggest(...a) as unknown,
    recalculateQuorum: (...a: unknown[]) => mockRecalc(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => toastSuccess(...a) as unknown,
    error: (...a: unknown[]) => toastError(...a) as unknown,
  },
}));

import { AttendancePanel } from './AttendancePanel';
import { renderWithRouter } from '../../../test/utils';
import type { AttendeeEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { user_id: 'u1', name: 'Alex Adams', status: 'present', present: true, note: null },
  { user_id: 'u2', name: 'Blake Brown', status: 'excused', present: false, note: 'Away' },
  { name: 'Visitor', status: 'guest', present: false },
];

describe('AttendancePanel', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReset();
    mockSuggest.mockReset();
    mockRecalc.mockReset();
    onSaved.mockReset();
    mockUpdate.mockResolvedValue({});
    mockRecalc.mockResolvedValue(undefined);
    onSaved.mockResolvedValue(undefined);
  });

  it('summarises the roll by status and lists everyone', () => {
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit={false} onSaved={onSaved} />);

    expect(screen.getByRole('heading', { name: /Attendance \(3\)/ })).toBeInTheDocument();
    expect(screen.getByText('1 present · 1 excused · 1 guest')).toBeInTheDocument();
    expect(screen.getByText(/Alex Adams/)).toBeInTheDocument();
    expect(screen.getByText(/Visitor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /attendance|roll call/i })).not.toBeInTheDocument();
  });

  it('reads a row saved before statuses existed from its present flag', () => {
    renderWithRouter(
      <AttendancePanel
        minutesId="m1"
        attendees={[
          { name: 'Old In', present: true },
          { name: 'Old Out', present: false },
        ]}
        canEdit={false}
        onSaved={onSaved}
      />
    );

    expect(screen.getByText('1 present · 1 absent')).toBeInTheDocument();
  });

  it('shows nothing to a reader when no roll was taken', () => {
    const { container } = renderWithRouter(
      <AttendancePanel minutesId="m1" attendees={[]} canEdit={false} onSaved={onSaved} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to take the roll when there is none and the user can edit', () => {
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={[]} canEdit onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: 'Take roll call' })).toBeInTheDocument();
    expect(screen.getByText('No roll call recorded.')).toBeInTheDocument();
  });

  it('saves every field the roll owns, clears a blank note with null, then recalculates quorum', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
    await user.selectOptions(screen.getByLabelText('Attendance for Alex Adams'), 'late');
    await user.clear(screen.getByLabelText('Note for Blake Brown'));
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    expect(mockUpdate).toHaveBeenCalledWith('m1', {
      attendees: [
        { user_id: 'u1', name: 'Alex Adams', role: null, status: 'late', note: null },
        { user_id: 'u2', name: 'Blake Brown', role: null, status: 'excused', note: null },
        { user_id: null, name: 'Visitor', role: null, status: 'guest', note: null },
      ],
    });
    expect(mockRecalc).toHaveBeenCalledWith('m1');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Attendance saved');
    expect(screen.queryByRole('button', { name: 'Save attendance' })).not.toBeInTheDocument();
  });

  it('still saves when quorum checking is not configured', async () => {
    mockRecalc.mockRejectedValue(new Error('quorum off'));
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('stays in edit mode and reports the error when the save is refused', async () => {
    mockUpdate.mockRejectedValue(new Error('A member can be listed only once in attendance'));
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
    await user.click(screen.getByRole('button', { name: 'Save attendance' }));

    expect(toastError).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeInTheDocument();
  });

  it('replaces the draft with the suggested roll and says where it came from', async () => {
    mockSuggest.mockResolvedValue({
      source: 'event',
      event_title: 'October business meeting',
      entries: [{ user_id: 'u9', name: 'Casey Cole', status: 'present', present: true }],
    });
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={[]} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Take roll call' }));
    await user.click(screen.getByRole('button', { name: 'Suggest from event or members' }));

    expect(await screen.findByLabelText('Attendance for Casey Cole')).toHaveValue('present');
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('October business meeting'));
  });

  it('adds a typed guest as a guest and ignores a blank name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={[]} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Take roll call' }));
    expect(screen.getByRole('button', { name: 'Add guest' })).toBeDisabled();
    await user.type(screen.getByLabelText('Add a guest'), 'Mayor Reyes{Enter}');

    expect(screen.getByLabelText('Attendance for Mayor Reyes')).toHaveValue('guest');
    expect(screen.getByLabelText('Add a guest')).toHaveValue('');
  });

  it('marks every member present without touching guests', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
    await user.click(screen.getByRole('button', { name: 'Mark all members present' }));

    expect(screen.getByLabelText('Attendance for Blake Brown')).toHaveValue('present');
    expect(screen.getByLabelText('Attendance for Visitor')).toHaveValue('guest');
  });

  it('removes a line from the roll', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
    await user.click(screen.getByRole('button', { name: 'Remove Visitor from the roll' }));

    const list = screen.getByRole('list');
    expect(within(list).queryByText('Visitor')).not.toBeInTheDocument();
    expect(within(list).getByText('Alex Adams')).toBeInTheDocument();
  });

  it('discards edits on cancel', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
    await user.selectOptions(screen.getByLabelText('Attendance for Alex Adams'), 'absent');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('1 present · 1 excused · 1 guest')).toBeInTheDocument();
  });
});
