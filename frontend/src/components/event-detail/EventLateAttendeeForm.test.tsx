/**
 * Recording one member on an event whose check-in has closed (workflow review
 * W80-8). The form adds the member and records their times, the two writes the
 * Edit Times dialog makes for someone never checked in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAdd = vi.fn();
const mockOverride = vi.fn();

vi.mock('../../services/api', () => ({
  eventService: {
    addAttendee: (...args: unknown[]) => mockAdd(...args) as unknown,
    overrideAttendance: (...args: unknown[]) => mockOverride(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import EventLateAttendeeForm from './EventLateAttendeeForm';

// 7-9 PM in Chicago (UTC-6 in November).
const START = '2026-11-08T01:00:00Z';
const END = '2026-11-08T03:00:00Z';
const members = [
  { id: 'u-blair', first_name: 'Blair', last_name: 'Carter' },
  { id: 'u-alex', first_name: 'Alex', last_name: 'Brooks' },
];

const openForm = () => {
  const onRecorded = vi.fn();
  render(
    <EventLateAttendeeForm
      eventId="evt-1"
      members={members}
      eventStart={START}
      eventEnd={END}
      timezone="America/Chicago"
      onRecorded={onRecorded}
    />
  );
  return onRecorded;
};

describe('EventLateAttendeeForm', () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockOverride.mockReset();
    mockAdd.mockResolvedValue({});
    mockOverride.mockResolvedValue({});
  });

  it('adds the member, then records the event’s times for them', async () => {
    const user = userEvent.setup();
    const onRecorded = openForm();

    await user.selectOptions(screen.getByLabelText('Member'), 'u-blair');
    await user.click(screen.getByRole('button', { name: 'Record attendance' }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    expect(mockAdd).toHaveBeenCalledWith('evt-1', { user_id: 'u-blair', status: 'going', checked_in: false });
    expect(mockOverride).toHaveBeenCalledWith('evt-1', 'u-blair', {
      override_check_in_at: '2026-11-08T01:00:00.000Z',
      override_check_out_at: '2026-11-08T03:00:00.000Z',
    });
    expect(mockAdd.mock.invocationCallOrder[0]).toBeLessThan(mockOverride.mock.invocationCallOrder[0] ?? 0);
  });

  it('asks for the member before writing anything', async () => {
    const user = userEvent.setup();
    openForm();

    await user.click(screen.getByRole('button', { name: 'Record attendance' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Choose the member who was there.');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('warns when the times run outside the event, without refusing them', async () => {
    openForm();

    fireEvent.change(screen.getByLabelText(/^Left$/), { target: { value: '2026-11-08' } });

    expect(
      await screen.findByText(/These times run outside the event, which ran 7:00\s?PM to 9:00\s?PM/)
    ).toBeInTheDocument();
  });

  it('shows the server’s refusal and keeps the choice', async () => {
    mockAdd.mockRejectedValue({
      response: { status: 403, data: { detail: 'You cannot record your own attendance.' } },
    });
    const user = userEvent.setup();
    const onRecorded = openForm();

    await user.selectOptions(screen.getByLabelText('Member'), 'u-alex');
    await user.click(screen.getByRole('button', { name: 'Record attendance' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot record your own attendance.');
    expect(screen.getByLabelText('Member')).toHaveValue('u-alex');
    expect(mockOverride).not.toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
