/**
 * A later meeting's motion may already have accepted these minutes; the page
 * says so and the adoption opens filled in. Prepared motions the meeting has
 * not acted on are not part of the record and are not listed as motions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

const MINUTES_ID = 'minutes-1';
const mockGetMinutes = vi.fn();
const mockProposal = vi.fn();
const authState = {
  checkPermission: () => true,
  user: { id: 'chief' } as { id: string } | undefined,
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
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
    getAdoptionProposal: (...a: unknown[]) => mockProposal(...a) as unknown,
    getSuggestions: () => Promise.resolve([]),
  },
}));
vi.mock('../../../services/api', () => ({
  // Read by the Governance section strip in the page header.
  organizationService: {
    getEnabledModules: vi.fn().mockResolvedValue({ configured: false, enabled_modules: [] }),
  },
  eventService: { getEvent: () => Promise.resolve(null), getEvents: () => Promise.resolve([]) },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) => (selector ? selector(authState) : authState),
}));

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const base = {
  id: MINUTES_ID,
  title: 'September business',
  meeting_type: 'business',
  meeting_date: '2026-09-03T19:00:00Z',
  status: 'submitted',
  submitted_by: 'secretary',
  sections: [],
  action_items: [],
  motions: [
    {
      id: 'pending-1',
      minutes_id: MINUTES_ID,
      order: 0,
      motion_text: 'Motion to adjourn the meeting.',
      section_key: 'adjournment',
      status: 'pending',
      created_at: '',
      updated_at: '',
    },
  ],
};

describe('MinutesDetailPage acceptance by a later meeting', () => {
  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(base);
    mockProposal.mockReset();
    mockProposal.mockResolvedValue(null);
  });

  it('says a later meeting accepted the minutes, and as what', async () => {
    mockProposal.mockResolvedValue({
      motion_id: 'mo1',
      adopted_on: '2026-10-02T00:00:00Z',
      adopting_minutes_id: 'minutes-2',
      adopting_minutes_title: 'October business',
      as_amended: true,
      moved_by: 'Pat Chief',
      seconded_by: 'Lee Treasurer',
    });
    renderWithRouter(<MinutesDetailPage />);

    const note = await screen.findByText(/accepted these minutes as revised/);
    expect(note).toHaveTextContent('moved by Pat Chief, seconded by Lee Treasurer');
    expect(screen.getByRole('link', { name: 'October business' })).toHaveAttribute('href', '/minutes/minutes-2');
  });

  it('says nothing when no meeting has accepted them', async () => {
    renderWithRouter(<MinutesDetailPage />);

    await screen.findByText('September business');
    expect(screen.queryByText(/accepted these minutes/)).not.toBeInTheDocument();
  });

  it('does not count or list a motion the meeting has not acted on', async () => {
    renderWithRouter(<MinutesDetailPage />);

    await screen.findByText('September business');
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });
});
