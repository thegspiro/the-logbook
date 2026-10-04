/**
 * Workflow review W51, on the minutes detail page:
 *
 * - an action item due on 15 October read "Due: 10/14/2026" in Chicago — a
 *   calendar day stored at UTC midnight was converted to the department's
 *   zone;
 * - the secretary who submitted the minutes was offered Approve, which the
 *   server then refused under separation of duties.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

const MINUTES_ID = 'minutes-1';
const SECRETARY = 'user-secretary';
const CHIEF = 'user-chief';

const mockGetMinutes = vi.fn();
const authState = {
  checkPermission: () => true,
  user: { id: SECRETARY } as { id: string } | undefined,
};

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
  minutesService: { getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown },
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

const submitted = {
  id: MINUTES_ID,
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'submitted',
  submitted_by: SECRETARY,
  sections: [],
  motions: [],
  action_items: [
    {
      id: 'ai-1',
      minutes_id: MINUTES_ID,
      description: 'Get three SCBA quotes',
      assignee_name: 'Quartermaster',
      due_date: '2026-10-15T00:00:00Z',
      priority: 'medium',
      status: 'pending',
    },
  ],
};

describe('MinutesDetailPage approval and due dates (W51)', () => {
  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(submitted);
    authState.user = { id: SECRETARY };
  });

  it('shows a due date as the calendar day it was entered for', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Due: Oct 15, 2026')).toBeInTheDocument();
  });

  it('does not offer Approve to the officer who submitted the minutes', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText(/You submitted these minutes, so you cannot approve them/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve Minutes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject Minutes' })).toBeInTheDocument();
  });

  it('offers Approve to another officer', async () => {
    authState.user = { id: CHIEF };
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByRole('button', { name: 'Approve Minutes' })).toBeInTheDocument();
  });
});
