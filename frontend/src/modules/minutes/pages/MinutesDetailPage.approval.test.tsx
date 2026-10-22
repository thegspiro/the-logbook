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
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';
const SECRETARY = 'user-secretary';
const CHIEF = 'user-chief';

const mockGetMinutes = vi.fn();
const mockReopen = vi.fn();
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
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
    reopen: (...a: unknown[]) => mockReopen(...a) as unknown,
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

  it('does not offer Adopt to the officer who circulated the minutes', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(
      await screen.findByText(/You circulated these minutes, so you cannot record their adoption/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adopt Minutes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return for Changes' })).toBeInTheDocument();
  });

  it('offers Adopt to another officer', async () => {
    authState.user = { id: CHIEF };
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByRole('button', { name: 'Adopt Minutes' })).toBeInTheDocument();
  });
});

describe('MinutesDetailPage reopen for correction (MM-17)', () => {
  const approved = { ...submitted, status: 'approved', approved_by: CHIEF };

  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(approved);
    mockReopen.mockReset();
    mockReopen.mockResolvedValue({ ...approved, status: 'draft', approved_by: null, submitted_by: null });
    authState.user = { id: SECRETARY };
  });

  it('reopens approved minutes as a draft with the reason given', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Reopen for Correction' }));
    await user.type(screen.getByLabelText(/What needs correcting/), 'Quorum threshold was entered wrong');
    await user.click(screen.getByRole('button', { name: 'Reopen as draft' }));

    expect(mockReopen).toHaveBeenCalledWith(MINUTES_ID, 'Quorum threshold was entered wrong');
    expect(await screen.findByRole('button', { name: 'Circulate for Review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen for Correction' })).not.toBeInTheDocument();
  });

  it('is not offered on minutes that are not approved', async () => {
    mockGetMinutes.mockResolvedValue(submitted);
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByRole('button', { name: 'Return for Changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen for Correction' })).not.toBeInTheDocument();
  });

  it('tells the secretary a published copy is marked as being corrected until re-published', async () => {
    const user = userEvent.setup();
    mockGetMinutes.mockResolvedValue({ ...approved, published_document_id: 'doc-1' });
    mockReopen.mockResolvedValue({
      ...approved,
      published_document_id: 'doc-1',
      status: 'draft',
      approved_by: null,
      submitted_by: null,
    });
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Reopen for Correction' }));
    expect(screen.queryByText(/marked as being corrected/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/What needs correcting/), 'Quorum threshold was entered wrong');
    await user.click(screen.getByRole('button', { name: 'Reopen as draft' }));

    expect(await screen.findByText(/The copy published to Documents is marked as being corrected/)).toBeInTheDocument();
  });

  it('says nothing about a published copy when none was published', async () => {
    mockGetMinutes.mockResolvedValue({ ...submitted, status: 'draft' });
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByRole('button', { name: 'Circulate for Review' })).toBeInTheDocument();
    expect(screen.queryByText(/marked as being corrected/)).not.toBeInTheDocument();
  });
});
