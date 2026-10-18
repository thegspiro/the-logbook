/**
 * The roll is recorded in full; the listing decides what a reader is shown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    updateMinutes: (...a: unknown[]) => mockUpdate(...a) as unknown,
    getAttendanceSuggestions: vi.fn(),
    recalculateQuorum: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { AttendancePanel } from './AttendancePanel';
import { renderWithRouter } from '../../../test/utils';
import type { AttendeeEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { user_id: 'u1', name: 'Alex Adams', status: 'present', present: true },
  { user_id: 'u2', name: 'Blake Brown', status: 'excused', present: false },
  { user_id: 'u3', name: 'Casey Cole', status: 'absent', present: false },
  { name: 'Visitor', status: 'guest', present: false },
];

describe('AttendancePanel listing', () => {
  const onSaved = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue({});
    onSaved.mockReset();
    onSaved.mockResolvedValue(undefined);
  });

  it('names only who attended under "present only"', () => {
    renderWithRouter(
      <AttendancePanel minutesId="m1" attendees={roll} listing="present" canEdit={false} onSaved={onSaved} />
    );

    expect(screen.getByRole('heading', { name: /Attendance \(2\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Alex Adams/)).toBeInTheDocument();
    expect(screen.getByText(/Visitor/)).toBeInTheDocument();
    expect(screen.queryByText(/Blake Brown/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Casey Cole/)).not.toBeInTheDocument();
    expect(screen.getByText('1 present · 1 guest')).toBeInTheDocument();
  });

  it('names the excused but not the absent under "present and excused"', () => {
    renderWithRouter(
      <AttendancePanel minutesId="m1" attendees={roll} listing="present_excused" canEdit={false} onSaved={onSaved} />
    );

    expect(screen.getByText(/Blake Brown/)).toBeInTheDocument();
    expect(screen.queryByText(/Casey Cole/)).not.toBeInTheDocument();
  });

  it('names everyone by default', () => {
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} canEdit={false} onSaved={onSaved} />);

    expect(screen.getByText(/Casey Cole/)).toBeInTheDocument();
  });

  it('shows a reader no control over the listing', () => {
    renderWithRouter(
      <AttendancePanel minutesId="m1" attendees={roll} listing="present" canEdit={false} onSaved={onSaved} />
    );

    expect(screen.queryByLabelText('Who these minutes name')).not.toBeInTheDocument();
  });

  it('tells a manager how many are recorded but not named', () => {
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} listing="present" canEdit onSaved={onSaved} />);

    expect(screen.getByText(/2 members are recorded but not named/)).toBeInTheDocument();
  });

  it('lets a manager override the department for one set of minutes', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <AttendancePanel
        minutesId="m1"
        attendees={roll}
        listing="present"
        listingOverride={null}
        canEdit
        onSaved={onSaved}
      />
    );

    expect(screen.getByRole('option', { name: 'Department default (present only)' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Who these minutes name'), 'all');

    expect(mockUpdate).toHaveBeenCalledWith('m1', { attendance_listing: 'all' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('sends an explicit null to go back to the department default', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <AttendancePanel minutesId="m1" attendees={roll} listing="all" listingOverride="all" canEdit onSaved={onSaved} />
    );

    await user.selectOptions(screen.getByLabelText('Who these minutes name'), '');

    expect(mockUpdate).toHaveBeenCalledWith('m1', { attendance_listing: null });
  });

  it('still edits the whole roll', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AttendancePanel minutesId="m1" attendees={roll} listing="present" canEdit onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: 'Edit attendance' }));

    expect(screen.getByLabelText('Attendance for Casey Cole')).toBeInTheDocument();
  });
});
