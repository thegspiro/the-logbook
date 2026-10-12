/**
 * W52-6: an action item is assigned to a member, picked from every active
 * member, so "Assigned to me" can find it. The typed name is gone; items
 * already assigned by name keep showing that name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';

const mockGetMinutes = vi.fn();
const mockGetAssignees = vi.fn();
const mockAddActionItem = vi.fn();
const authState = { checkPermission: () => true, user: { id: 'user-secretary' } };

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ minutesId: MINUTES_ID }), useNavigate: () => vi.fn() };
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
    getActionItemAssignees: (...a: unknown[]) => mockGetAssignees(...a) as unknown,
    addActionItem: (...a: unknown[]) => mockAddActionItem(...a) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  eventService: { getEvent: () => Promise.resolve(null), getEvents: () => Promise.resolve([]) },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const draft = {
  id: MINUTES_ID,
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'draft',
  sections: [],
  motions: [],
  action_items: [
    {
      id: 'ai-legacy',
      minutes_id: MINUTES_ID,
      description: 'Get three SCBA quotes',
      assignee_name: 'Quartermaster',
      priority: 'medium',
      status: 'pending',
    },
  ],
};

describe('MinutesDetailPage action-item assignee picker (W52-6)', () => {
  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockGetAssignees.mockReset();
    mockAddActionItem.mockReset();
    mockGetMinutes.mockResolvedValue(draft);
    mockGetAssignees.mockResolvedValue([
      { id: 'u-alice', name: 'Alice Adams' },
      { id: 'u-bob', name: 'Bob Brown' },
    ]);
    mockAddActionItem.mockResolvedValue({ id: 'ai-new' });
  });

  it('assigns a picked member by id and sends no typed name', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Add Action Item' }));
    const form = screen.getByRole('form', { name: 'Add action item' });
    const picker = within(form).getByLabelText('Assignee');
    await within(form).findByRole('option', { name: 'Bob Brown' });
    expect(within(form).queryByPlaceholderText('Assignee name')).not.toBeInTheDocument();

    await user.type(within(form).getByLabelText('Action item description'), 'Order hose');
    await user.selectOptions(picker, 'u-bob');
    await user.click(within(form).getByRole('button', { name: 'Add Action Item' }));

    expect(mockAddActionItem).toHaveBeenCalledWith(MINUTES_ID, {
      description: 'Order hose',
      assignee_id: 'u-bob',
      due_date: undefined,
      priority: 'medium',
    });
  });

  it('leaves an item unassigned when no member is picked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Add Action Item' }));
    const form = screen.getByRole('form', { name: 'Add action item' });
    await within(form).findByRole('option', { name: 'Alice Adams' });
    await user.type(within(form).getByLabelText('Action item description'), 'Sweep bay');
    await user.click(within(form).getByRole('button', { name: 'Add Action Item' }));

    expect(mockAddActionItem).toHaveBeenCalledWith(MINUTES_ID, expect.objectContaining({ assignee_id: undefined }));
  });

  it('keeps showing the name on an item assigned before the picker', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Assigned to: Quartermaster')).toBeInTheDocument();
  });
});
