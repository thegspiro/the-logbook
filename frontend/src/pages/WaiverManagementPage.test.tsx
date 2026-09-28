/**
 * Waiver Management: what the create form offers, and what it sends.
 *
 * A leave of absence has no field saying whether it covers meetings or shifts;
 * every reader treats it as covering both. The form offered the two as
 * separate choices, so "Meeting Attendance" alone created a leave that also
 * excused every shift (workflow review W13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockListLeaves = vi.fn();
const mockListWaivers = vi.fn();
const mockCreateLeave = vi.fn();
const mockCreateWaiver = vi.fn();
const mockDeleteLeave = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../services/api', () => ({
  memberStatusService: {
    listLeavesOfAbsence: (...args: unknown[]) => mockListLeaves(...args) as unknown,
    listTrainingWaivers: (...args: unknown[]) => mockListWaivers(...args) as unknown,
    createLeaveOfAbsence: (...args: unknown[]) => mockCreateLeave(...args) as unknown,
    createTrainingWaiver: (...args: unknown[]) => mockCreateWaiver(...args) as unknown,
    deleteLeaveOfAbsence: (...args: unknown[]) => mockDeleteLeave(...args) as unknown,
    deleteTrainingWaiver: vi.fn(),
  },
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
}));

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({
    formatRank: (code: string | null | undefined) => (code === 'fire_chief' ? 'Chief' : (code ?? '')),
  }),
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) as unknown, success: vi.fn() },
}));

import { WaiverManagementPage } from './WaiverManagementPage';

const chief = { id: 'u1', username: 'cmorgan', full_name: 'Casey Morgan', rank: 'fire_chief', status: 'active' };

const leave = {
  id: 'loa-1',
  user_id: 'u1',
  leave_type: 'medical',
  reason: null,
  start_date: '2026-01-01',
  end_date: null,
  granted_by: null,
  granted_at: null,
  active: true,
  exempt_from_training_waiver: true,
  linked_training_waiver_id: null,
};

const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByLabelText('Member'), 'u1');
  await user.type(screen.getByLabelText('Start Date'), '2026-10-01');
  await user.type(screen.getByLabelText('End Date', { exact: true }), '2026-12-31');
  // The tab strip carries a "Create Waiver" button too; this is the form's.
  const submit = screen
    .getAllByRole('button', { name: 'Create Waiver' })
    .find((b) => b.getAttribute('type') === 'submit');
  await user.click(submit ?? document.body);
};

describe('WaiverManagementPage — creating a waiver (workflow review W13)', () => {
  beforeEach(() => {
    for (const m of [
      mockListLeaves,
      mockListWaivers,
      mockCreateLeave,
      mockCreateWaiver,
      mockGetUsers,
      mockToastError,
    ]) {
      m.mockReset();
    }
    mockListLeaves.mockResolvedValue([]);
    mockListWaivers.mockResolvedValue([]);
    mockCreateLeave.mockResolvedValue({});
    mockCreateWaiver.mockResolvedValue({});
    mockGetUsers.mockResolvedValue([chief]);
    window.history.replaceState({}, '', '/members/admin/waivers?tab=create');
  });

  it('offers meetings and shifts as one choice, because a leave covers both', async () => {
    renderWithRouter(<WaiverManagementPage />);

    const group = await screen.findByRole('group', { name: 'Applies To' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(within(group).getByLabelText('Meeting Attendance & Shift Requirements')).toBeChecked();
    expect(within(group).queryByLabelText('Meeting Attendance')).not.toBeInTheDocument();
  });

  it('creates a leave that keeps training active when training is left out', async () => {
    const user = userEvent.setup();
    renderWithRouter(<WaiverManagementPage />);
    await screen.findByRole('group', { name: 'Applies To' });

    await user.click(screen.getByLabelText('Training Requirements'));
    await fillAndSubmit(user);

    await waitFor(() => expect(mockCreateLeave).toHaveBeenCalled());
    expect(mockCreateLeave.mock.calls[0]?.[0]).toMatchObject({ user_id: 'u1', exempt_from_training_waiver: true });
    expect(mockCreateWaiver).not.toHaveBeenCalled();
  });

  it('creates a standalone training waiver when only training is chosen', async () => {
    const user = userEvent.setup();
    renderWithRouter(<WaiverManagementPage />);
    await screen.findByRole('group', { name: 'Applies To' });

    await user.click(screen.getByLabelText('Meeting Attendance & Shift Requirements'));
    await fillAndSubmit(user);

    await waitFor(() => expect(mockCreateWaiver).toHaveBeenCalled());
    expect(mockCreateLeave).not.toHaveBeenCalled();
  });

  it('labels the form and names each member by rank, not rank code', async () => {
    renderWithRouter(<WaiverManagementPage />);

    const member = await screen.findByLabelText('Member');
    expect(within(member).getByRole('option', { name: 'Casey Morgan (Chief)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Waiver Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toBeInTheDocument();
  });
});

describe('WaiverManagementPage — deactivating and filtering (workflow review W13)', () => {
  beforeEach(() => {
    for (const m of [mockListLeaves, mockListWaivers, mockDeleteLeave, mockGetUsers, mockToastError]) {
      m.mockReset();
    }
    mockListLeaves.mockResolvedValue([leave]);
    mockListWaivers.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([chief]);
  });

  it("shows the server's reason when a deactivation is refused", async () => {
    const user = userEvent.setup();
    mockDeleteLeave.mockRejectedValue({ response: { status: 400, data: { detail: 'Leave already ended.' } } });
    window.history.replaceState({}, '', '/members/admin/waivers?tab=active');
    renderWithRouter(<WaiverManagementPage />);

    await user.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Leave already ended.'));
  });

  it('says which history filter is selected', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/members/admin/waivers?tab=history');
    renderWithRouter(<WaiverManagementPage />);

    const future = await screen.findByRole('button', { name: 'Future' });
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(future);
    expect(future).toHaveAttribute('aria-pressed', 'true');
  });
});
