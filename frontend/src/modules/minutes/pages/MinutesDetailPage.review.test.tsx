/**
 * The review-and-adopt flow as the detail page wires it: members suggest while
 * the minutes circulate, an officer adopts or recalls them, and the page shows
 * how they were adopted, which motions a ballot decided, and which sections an
 * outline requires.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';
const SECRETARY = 'user-secretary';
const CHIEF = 'user-chief';

const mockGetMinutes = vi.fn();
const mockApprove = vi.fn();
const mockRecall = vi.fn();
const mockApplyOutline = vi.fn();
const mockAddMotion = vi.fn();
const mockGetSuggestions = vi.fn();
const mockGetOutlines = vi.fn();
const mockImportable = vi.fn();
const authState = {
  checkPermission: (_p: string) => true,
  user: { id: CHIEF } as { id: string } | undefined,
};

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ minutesId: MINUTES_ID }), useNavigate: () => vi.fn() };
});

vi.mock('../../../services/electionService', () => ({
  electionService: { getElectionsByEvent: () => Promise.resolve([]) },
}));

vi.mock('../services/api', () => ({
  minutesService: {
    getMinutes: (...a: unknown[]) => mockGetMinutes(...a) as unknown,
    approve: (...a: unknown[]) => mockApprove(...a) as unknown,
    recall: (...a: unknown[]) => mockRecall(...a) as unknown,
    applyOutline: (...a: unknown[]) => mockApplyOutline(...a) as unknown,
    addMotion: (...a: unknown[]) => mockAddMotion(...a) as unknown,
    getSuggestions: (...a: unknown[]) => mockGetSuggestions(...a) as unknown,
    getOutlines: (...a: unknown[]) => mockGetOutlines(...a) as unknown,
    getImportableElections: (...a: unknown[]) => mockImportable(...a) as unknown,
    listAllMinutes: () => Promise.resolve([]),
    getElectionResults: () => Promise.resolve([]),
    getAttachments: () => Promise.resolve([]),
    getRevisions: () => Promise.resolve([]),
    getClosedSessions: () => Promise.resolve([]),
    verify: () => Promise.resolve({ verified: true, version: 1, changed: [], detail: 'ok' }),
    getOpenActionItems: () => Promise.resolve([]),
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

const base = {
  id: MINUTES_ID,
  title: 'October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'submitted',
  submitted_by: SECRETARY,
  updated_at: '2026-10-02T00:00:00Z',
  attendees: [],
  sections: [{ order: 0, key: 'old_business', title: 'Old Business', content: '' }],
  motions: [],
  action_items: [],
};

describe('MinutesDetailPage review and adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of [
      mockGetMinutes,
      mockApprove,
      mockRecall,
      mockApplyOutline,
      mockAddMotion,
      mockGetSuggestions,
      mockGetOutlines,
      mockImportable,
    ]) {
      m.mockReset();
    }
    mockGetMinutes.mockResolvedValue(base);
    mockGetSuggestions.mockResolvedValue([]);
    mockGetOutlines.mockResolvedValue([]);
    mockImportable.mockResolvedValue([]);
    authState.checkPermission = () => true;
    authState.user = { id: CHIEF };
  });

  it('lets a member who cannot manage minutes leave a suggestion while they circulate', async () => {
    authState.checkPermission = (p: string) => p !== 'minutes.manage';
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByLabelText('What should change?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adopt Minutes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recall to Draft' })).not.toBeInTheDocument();
  });

  it('adopts with the details entered in the dialog and then shows the adoption line', async () => {
    const adopted = {
      ...base,
      status: 'approved',
      adopted_on: '2026-11-05T01:00:00Z',
      adopted_as_amended: false,
      adopting_minutes_id: 'minutes-2',
      adopting_minutes_title: 'November Business Meeting',
    };
    mockApprove.mockResolvedValue(adopted);
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Adopt Minutes' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'As presented' }));
    await user.click(within(dialog).getByRole('button', { name: 'Adopt Minutes' }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledTimes(1));
    expect(mockApprove).toHaveBeenCalledWith(
      MINUTES_ID,
      expect.objectContaining({ as_amended: false, adopting_minutes_id: undefined })
    );
    expect(await screen.findByText(/as presented/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'November Business Meeting' })).toHaveAttribute(
      'href',
      '/minutes/minutes-2'
    );
  });

  it('preselects "as amended" when a suggestion was accepted', async () => {
    mockGetSuggestions.mockResolvedValue([
      {
        id: 's1',
        minutes_id: MINUTES_ID,
        comment: 'Fix the date',
        status: 'accepted',
        created_at: '2026-10-03T00:00:00Z',
      },
    ]);
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Adopt Minutes' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'As amended' })).toBeChecked());
  });

  it('recalls circulating minutes to draft only after confirmation', async () => {
    mockRecall.mockResolvedValue({ ...base, status: 'draft', submitted_by: null });
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Recall to Draft' }));
    await user.click(await screen.findByRole('button', { name: 'Leave them circulating' }));
    expect(mockRecall).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Recall to Draft' }));
    await user.click(await screen.findByRole('button', { name: 'Recall to draft' }));
    await waitFor(() => expect(mockRecall).toHaveBeenCalledWith(MINUTES_ID));
    expect(await screen.findByRole('button', { name: 'Circulate for Review' })).toBeInTheDocument();
  });

  it('marks an empty required section on a draft', async () => {
    mockGetMinutes.mockResolvedValue({
      ...base,
      status: 'draft',
      sections: [
        { order: 0, key: 'roll_call', title: 'Roll Call', content: '', required: true },
        { order: 1, key: 'old_business', title: 'Old Business', content: '', required: false },
      ],
    });
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Required')).toBeInTheDocument();
  });

  it('lays an outline over a draft', async () => {
    mockGetMinutes.mockResolvedValue({ ...base, status: 'draft' });
    mockGetOutlines.mockResolvedValue([
      { id: 'o1', name: 'Regular order', meeting_type: 'business', is_default: true, section_count: 8, created_at: '' },
    ]);
    mockApplyOutline.mockResolvedValue({ ...base, status: 'draft' });
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Apply an outline' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Apply outline' }));
    await waitFor(() => expect(mockApplyOutline).toHaveBeenCalledWith(MINUTES_ID, 'o1'));
  });

  it('does not offer an outline on circulating minutes', async () => {
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByRole('button', { name: 'Adopt Minutes' });
    expect(screen.queryByRole('button', { name: 'Apply an outline' })).not.toBeInTheDocument();
  });

  it('links a motion to the ballot that decided it', async () => {
    mockGetMinutes.mockResolvedValue({
      ...base,
      motions: [
        {
          id: 'mo1',
          minutes_id: MINUTES_ID,
          motion_text: 'Adopt the budget',
          status: 'passed',
          order: 0,
          election_id: 'e1',
          election_title: 'Budget vote',
        },
      ],
    });
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByRole('link', { name: 'Budget vote' })).toHaveAttribute('href', '/elections/e1');
  });

  it('records a motion as decided by a ballot item', async () => {
    mockGetMinutes.mockResolvedValue({ ...base, status: 'draft' });
    mockImportable.mockResolvedValue([
      {
        id: 'e1',
        title: 'Budget vote',
        already_imported: false,
        ballot_items: [{ id: 'item-1', title: 'Approve the budget' }],
      },
    ]);
    mockAddMotion.mockResolvedValue({});
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Add Motion' }));
    await user.type(screen.getByLabelText('Motion text'), 'Approve the budget');
    await user.selectOptions(await screen.findByLabelText('Decided by ballot'), 'e1');
    await user.selectOptions(await screen.findByLabelText('Item on that ballot'), 'item-1');
    await user.click(screen.getByRole('button', { name: 'Add Motion' }));

    await waitFor(() => expect(mockAddMotion).toHaveBeenCalledTimes(1));
    expect(mockAddMotion).toHaveBeenCalledWith(
      MINUTES_ID,
      expect.objectContaining({ motion_text: 'Approve the budget', election_id: 'e1', ballot_item_id: 'item-1' })
    );
  });
});
