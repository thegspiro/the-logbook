/**
 * W50-73 — the "remove from attendance" control on each Present pill was a
 * 28px box, under the 44px touch minimum every other icon button meets via
 * `btn-icon`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Election } from '../types/election';

const getAttendees = vi.fn();
const getUsers = vi.fn();
vi.mock('../services/api', () => ({
  electionService: {
    getAttendees: (...args: unknown[]) => getAttendees(...args) as unknown,
  },
  userService: {
    getUsers: (...args: unknown[]) => getUsers(...args) as unknown,
  },
}));
vi.mock('../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));
vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { MeetingAttendance } from './MeetingAttendance';

const attendee = { user_id: 'u-1', name: 'Jane Doe', checked_in_at: '2026-09-30T18:00:00Z', checked_in_by: 'u-2' };
const election = { id: 'elec-1', status: 'open', attendees: [attendee] } as unknown as Election;

describe('MeetingAttendance remove button touch target (W50-73)', () => {
  beforeEach(() => {
    getAttendees.mockReset();
    getUsers.mockReset();
    getAttendees.mockResolvedValue({ attendees: [attendee], total: 1 });
    getUsers.mockResolvedValue([]);
  });

  it('uses btn-icon for the 44px minimum', async () => {
    render(<MeetingAttendance electionId="elec-1" election={election} onUpdate={vi.fn()} />);
    const remove = await screen.findByRole('button', { name: 'Remove Jane Doe from attendance' });
    expect(remove).toHaveClass('btn-icon');
    expect(remove.className).not.toMatch(/min-h-\[28px\]/);
  });
});
