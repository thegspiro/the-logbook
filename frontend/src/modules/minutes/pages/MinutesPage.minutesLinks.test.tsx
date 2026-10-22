/**
 * Workflow review W51: the Minutes page listed meetings and could create
 * minutes from one, but never led back to minutes that existed. An approver
 * had no way to find minutes awaiting approval, a member none to find approved
 * ones, and pressing the book icon again wrote a second set for a meeting
 * already approved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MinutesListItem } from '../types/minutes';

const mockGetMeetings = vi.fn();
const mockGetSummary = vi.fn();
const mockCreateMeeting = vi.fn();
const mockListAllMinutes = vi.fn();
const mockGetStats = vi.fn();
const mockCreateFromMeeting = vi.fn();
const mockGetOutlines = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  meetingsService: {
    getMeetings: (...a: unknown[]) => mockGetMeetings(...a) as unknown,
    getSummary: (...a: unknown[]) => mockGetSummary(...a) as unknown,
    createMeeting: (...a: unknown[]) => mockCreateMeeting(...a) as unknown,
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    listAllMinutes: (...a: unknown[]) => mockListAllMinutes(...a) as unknown,
    getStats: (...a: unknown[]) => mockGetStats(...a) as unknown,
    createFromMeeting: (...a: unknown[]) => mockCreateFromMeeting(...a) as unknown,
    getOutlines: (...a: unknown[]) => mockGetOutlines(...a) as unknown,
  },
}));

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: () => true, user: undefined };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import MinutesPage from './MinutesPage';
import { renderWithRouter } from '../../../test/utils';

const meeting = (id: string, title: string) => ({
  id,
  organization_id: 'org-1',
  title,
  meeting_type: 'business',
  meeting_date: '2026-10-01',
  start_time: '19:00:00',
  location: 'Station 1',
  called_by: null,
  status: 'draft',
  notes: null,
  created_at: '2026-10-03T13:30:47Z',
  updated_at: '2026-10-03T13:30:47Z',
  attendee_count: 0,
  action_item_count: 0,
});

const minutesItem = (overrides: Partial<MinutesListItem>): MinutesListItem => ({
  id: 'min-1',
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'submitted',
  motions_count: 0,
  action_items_count: 0,
  open_action_items: 0,
  created_at: '2026-10-03T13:31:00Z',
  meeting_id: 'meet-1',
  ...overrides,
});

describe('MinutesPage links meetings to their minutes (W51)', () => {
  beforeEach(() => {
    mockGetMeetings.mockReset();
    mockGetMeetings.mockResolvedValue({
      meetings: [meeting('meet-1', 'October Business Meeting'), meeting('meet-2', 'November Business Meeting')],
    });
    mockGetSummary.mockReset();
    mockGetSummary.mockResolvedValue({
      total_meetings: 2,
      meetings_this_month: 1,
      open_action_items: 0,
      pending_approval: 0,
    });
    mockListAllMinutes.mockReset();
    mockListAllMinutes.mockResolvedValue([minutesItem({})]);
    mockGetStats.mockReset();
    mockGetStats.mockResolvedValue({ total: 1, this_month: 1, open_action_items: 0, pending_approval: 1 });
    mockCreateFromMeeting.mockReset();
    mockCreateFromMeeting.mockResolvedValue({ id: 'min-new' });
    mockGetOutlines.mockReset();
    mockGetOutlines.mockResolvedValue([]);
    mockCreateMeeting.mockReset();
    mockNavigate.mockReset();
  });

  it('links a meeting to its minutes and says where they stand', async () => {
    renderWithRouter(<MinutesPage />);

    const link = await screen.findByRole('link', { name: /Minutes: October Business Meeting/ });
    expect(link).toHaveAttribute('href', '/minutes/min-1');
    expect(link).toHaveTextContent('Circulated for review');
  });

  it('counts minutes awaiting approval from the minutes service', async () => {
    // Every other tile, and the meeting summary's own pending figure, holds a
    // different number, so "7" can only have come from the minutes stats.
    mockGetSummary.mockResolvedValue({
      total_meetings: 2,
      meetings_this_month: 3,
      open_action_items: 4,
      pending_approval: 0,
    });
    mockGetStats.mockResolvedValue({ total: 1, this_month: 1, open_action_items: 0, pending_approval: 7 });
    renderWithRouter(<MinutesPage />);

    expect(await screen.findByText('7')).toBeInTheDocument();
  });

  // W52-5: the tile counted meeting action items only, so open items recorded
  // in minutes left it at 0.
  it('counts open action items from meetings and minutes together', async () => {
    mockGetSummary.mockResolvedValue({
      total_meetings: 2,
      meetings_this_month: 1,
      open_action_items: 2,
      pending_approval: 0,
    });
    mockGetStats.mockResolvedValue({ total: 1, this_month: 1, open_action_items: 6, pending_approval: 0 });
    renderWithRouter(<MinutesPage />);

    expect(await screen.findByText('8')).toBeInTheDocument();
  });

  it('opens existing minutes instead of writing a second set', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Open the minutes of October Business Meeting' }));

    expect(mockCreateFromMeeting).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/minutes/min-1');
  });

  it('creates minutes for a meeting that has none', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Create minutes from November Business Meeting' }));

    expect(mockCreateFromMeeting).toHaveBeenCalledWith('meet-2');
    expect(mockNavigate).toHaveBeenCalledWith('/minutes/min-new');
  });

  it('starts from the default outline without asking when the department has one for that meeting type', async () => {
    mockGetOutlines.mockResolvedValue([
      { id: 'o1', name: 'Regular order', meeting_type: 'business', is_default: true, section_count: 8, created_at: '' },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Create minutes from November Business Meeting' }));

    await waitFor(() => expect(mockCreateFromMeeting).toHaveBeenCalledWith('meet-2'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks which outline to use when there are several for that meeting type', async () => {
    mockGetOutlines.mockResolvedValue([
      { id: 'o1', name: 'Regular order', meeting_type: 'business', is_default: true, section_count: 8, created_at: '' },
      { id: 'o2', name: 'Short order', meeting_type: 'business', is_default: false, section_count: 4, created_at: '' },
      { id: 'o3', name: 'Board order', meeting_type: 'board', is_default: true, section_count: 5, created_at: '' },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Create minutes from November Business Meeting' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start the minutes from an outline' });
    expect(mockCreateFromMeeting).not.toHaveBeenCalled();
    await user.selectOptions(await within(dialog).findByRole('combobox'), 'o2');
    await user.click(within(dialog).getByRole('button', { name: 'Create minutes' }));

    await waitFor(() => expect(mockCreateFromMeeting).toHaveBeenCalledWith('meet-2', 'o2'));
    expect(mockNavigate).toHaveBeenCalledWith('/minutes/min-new');
  });

  // The list printed "2026-10-01" and "at 19:00".
  it('shows the meeting date and time as a person reads them', async () => {
    renderWithRouter(<MinutesPage />);

    expect((await screen.findAllByText('Thu, Oct 1, 2026')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('at 7:00 PM').length).toBeGreaterThan(0);
  });

  it('offers every meeting type a meeting record accepts (W51-4), in a named dialog', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Record Minutes' }));
    const dialog = screen.getByRole('dialog', { name: 'Record Meeting Minutes' });
    const types = within(within(dialog).getByLabelText('Meeting Type'))
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'));
    expect(types).toEqual(['business', 'special', 'committee', 'board', 'trustee', 'executive', 'annual', 'other']);
  });

  it('does not start recording without a date', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesPage />);

    await user.click(await screen.findByRole('button', { name: 'Record Minutes' }));
    const dialog = screen.getByRole('dialog', { name: 'Record Meeting Minutes' });
    await user.type(within(dialog).getByLabelText(/Meeting Title/), 'December Business Meeting');

    expect(within(dialog).getByRole('button', { name: 'Start Recording' })).toBeDisabled();
  });
});
