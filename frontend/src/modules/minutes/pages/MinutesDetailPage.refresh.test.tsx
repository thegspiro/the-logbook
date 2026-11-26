/**
 * MM6-3: recording a motion, changing an action item, applying a suggestion
 * — every change on the detail page reloaded through `fetchMinutes`, which
 * swaps the whole page for "Loading minutes...". Every panel unmounted and
 * lost its own state: a motion half-typed in another section, the decisions
 * made in the suggestions panel, the scroll position.
 *
 * MM6-4: the page is reused when the id in the address changes, and a failed
 * load's error was never cleared, so the next record — or a record reached
 * after one that 403'd — still read "Failed to load minutes". Other
 * per-record state (importable ballots, an open editor) carried over too.
 *
 * MM6-5: an item stored as overdue showed "Pending" in its status select,
 * and choosing Pending fired no change.
 *
 * MM6-6: "Return for Changes" could be sent twice by a double click.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let currentId = 'minutes-1';
const mockGetMinutes = vi.fn();
const mockUpdateActionItem = vi.fn();
const mockReject = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ minutesId: currentId }), useNavigate: () => vi.fn() };
});

vi.mock('../../../services/electionService', () => ({
  electionService: {
    getElectionsByEvent: () => Promise.resolve([]),
    getElectionsByMeeting: () => Promise.resolve([]),
  },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
    updateActionItem: (...a: unknown[]) => mockUpdateActionItem(...a) as unknown,
    reject: (...a: unknown[]) => mockReject(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  eventService: { getEvent: () => Promise.resolve(null), getEvents: () => Promise.resolve([]) },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: () => true, user: { id: 'user-chief' } };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const item = (status: string) => ({
  id: 'ai-1',
  minutes_id: 'minutes-1',
  description: 'Get three SCBA quotes',
  assignee_name: 'Quartermaster',
  due_date: '2026-10-15T00:00:00Z',
  priority: 'medium',
  status,
});

const record = (over: Record<string, unknown> = {}) => ({
  id: 'minutes-1',
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'draft',
  sections: [],
  motions: [],
  action_items: [item('pending')],
  ...over,
});

// The action items section starts collapsed.
const openStatusSelect = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /^Action Items/ }));
  return screen.getByRole('combobox', { name: /Update status for: Get three SCBA quotes/ });
};

describe('MinutesDetailPage after a change, and across records', () => {
  beforeEach(() => {
    currentId = 'minutes-1';
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(record());
    mockUpdateActionItem.mockReset();
    mockUpdateActionItem.mockResolvedValue(item('in_progress'));
    mockReject.mockReset();
  });

  it('keeps the page on screen while it reloads after a change', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    const select = await openStatusSelect(user);

    let release: (value: unknown) => void = () => undefined;
    mockGetMinutes.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    await user.selectOptions(select, 'in_progress');

    await waitFor(() => expect(mockGetMinutes).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Loading minutes...')).not.toBeInTheDocument();
    expect(screen.getByText('Get three SCBA quotes')).toBeInTheDocument();
    release(record({ action_items: [item('in_progress')] }));
  });

  it('clears a failed load once the next record loads', async () => {
    mockGetMinutes.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    const view = renderWithRouter(<MinutesDetailPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    currentId = 'minutes-2';
    mockGetMinutes.mockResolvedValue(record({ id: 'minutes-2', title: 'Minutes: November Business Meeting' }));
    view.rerender(<MinutesDetailPage />);

    expect(await screen.findByText('Minutes: November Business Meeting')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load minutes|status code 403/)).not.toBeInTheDocument();
  });

  it('shows an overdue item as overdue, so Pending is a real change', async () => {
    mockGetMinutes.mockResolvedValue(record({ action_items: [item('overdue')] }));
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    const select = await openStatusSelect(user);

    expect(select).toHaveDisplayValue('Overdue');
    await user.selectOptions(select, 'pending');
    expect(mockUpdateActionItem).toHaveBeenCalledWith('minutes-1', 'ai-1', { status: 'pending' });
  });

  it('sends Return for Changes once, however fast it is clicked', async () => {
    mockGetMinutes.mockResolvedValue(record({ status: 'submitted', submitted_by: 'user-secretary' }));
    mockReject.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Return for Changes' }));
    await user.type(screen.getByLabelText(/What needs to change/), 'The treasurer report figures are wrong');
    const reject = screen.getByRole('button', { name: 'Reject' });
    await user.dblClick(reject);

    expect(mockReject).toHaveBeenCalledTimes(1);
  });
});
