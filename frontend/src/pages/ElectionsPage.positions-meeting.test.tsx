/**
 * Two parts of the create form an officer election depends on:
 *
 * - Officer and board seats (President, Secretary) are positions, not
 *   operational ranks, so the suggestions offer both — a name in both lists
 *   once, and never the baseline "Member" position.
 * - Linking a meeting sets the voting window to the meeting's own start and
 *   end, read as the department's wall-clock time.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetElections = vi.fn();
const mockGetRanks = vi.fn();
const mockGetRoles = vi.fn();
const mockGetMeetings = vi.fn();

vi.mock('../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  electionService: {
    getElections: (...args: unknown[]) => mockGetElections(...args) as unknown,
    getElectionSettings: vi.fn().mockRejectedValue(new Error('not needed')),
  },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: (...args: unknown[]) => mockGetMeetings(...args) as unknown },
  ranksService: { getRanks: (...args: unknown[]) => mockGetRanks(...args) as unknown },
  roleService: { getRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    user: { id: 'u1', permissions: ['elections.manage'] },
    checkPermission: () => true,
  }),
}));

import { ElectionsPage } from './ElectionsPage';

const role = (id: string, slug: string, name: string) => ({ id, slug, name, permissions: [], is_system: true });

async function openCreateDialog() {
  renderWithRouter(<ElectionsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /^Create Election$/ }));
  await waitFor(() => expect(mockGetRoles).toHaveBeenCalled());
}

describe('ElectionsPage create form: positions and linked meeting', () => {
  beforeEach(() => {
    mockGetElections.mockReset();
    mockGetElections.mockResolvedValue([]);
    mockGetRanks.mockReset();
    mockGetRanks.mockResolvedValue([
      { id: 'r1', rank_code: 'CHIEF', display_name: 'Chief', description: null, is_active: true },
      { id: 'r2', rank_code: 'CAPT', display_name: 'Captain', description: null, is_active: true },
    ]);
    mockGetRoles.mockReset();
    mockGetRoles.mockResolvedValue([
      role('p1', 'president', 'President'),
      role('p2', 'vice_president', 'Vice President'),
      role('p3', 'fire_chief', 'Chief'),
      role('p4', 'member', 'Member'),
    ]);
    mockGetMeetings.mockReset();
    mockGetMeetings.mockResolvedValue({ meetings: [] });
  });

  it('offers department positions beside ranks, each name once, without Member', async () => {
    await openCreateDialog();
    await userEvent.click(screen.getByRole('combobox', { name: 'Position name' }));

    const listbox = screen.getByRole('listbox', { name: 'Available positions' });
    const names = within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toEqual(['PresidentPosition', 'Vice PresidentPosition', 'ChiefPosition', 'CaptainRank']);
  });

  it('still offers ranks when the positions list cannot be read', async () => {
    mockGetRoles.mockRejectedValue(new Error('403'));
    await openCreateDialog();
    await userEvent.click(screen.getByRole('combobox', { name: 'Position name' }));

    const listbox = screen.getByRole('listbox', { name: 'Available positions' });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['ChiefRank', 'CaptainRank']);
  });

  it("sets the voting window to a linked meeting's start and end", async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [
        {
          id: 'm1',
          title: 'Annual Meeting',
          meeting_date: '2099-12-10',
          start_time: '19:00:00',
          end_time: '21:30:00',
        },
      ],
    });
    await openCreateDialog();

    await userEvent.selectOptions(await screen.findByLabelText(/Linked Meeting/), 'meeting:m1');

    expect(screen.getByLabelText(/Start Date & Time/)).toHaveValue('2099-12-10');
    expect(screen.getByRole('combobox', { name: 'Start time hour' })).toHaveDisplayValue('7');
    expect(screen.getByRole('combobox', { name: 'Start time minute' })).toHaveDisplayValue('00');
    expect(screen.getByRole('combobox', { name: 'Start time AM/PM' })).toHaveDisplayValue('PM');
    expect(screen.getByLabelText(/End Date & Time/)).toHaveValue('2099-12-10');
    expect(screen.getByRole('combobox', { name: 'End time hour' })).toHaveDisplayValue('9');
    expect(screen.getByRole('combobox', { name: 'End time minute' })).toHaveDisplayValue('30');
    expect(screen.getByRole('combobox', { name: 'End time AM/PM' })).toHaveDisplayValue('PM');
  });

  it('leaves the dates alone when the meeting has no start time', async () => {
    mockGetMeetings.mockResolvedValue({
      meetings: [{ id: 'm1', title: 'Annual Meeting', meeting_date: '2099-12-10' }],
    });
    await openCreateDialog();

    await userEvent.selectOptions(await screen.findByLabelText(/Linked Meeting/), 'meeting:m1');

    expect(screen.getByLabelText(/Start Date & Time/)).toHaveValue('');
  });
});
