import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetTestViewers = vi.fn();
const mockAddTestViewer = vi.fn();
const mockRemoveTestViewer = vi.fn();
const mockSearchCandidates = vi.fn();

vi.mock('../../services/api', () => ({
  skillsTestingService: {
    getTestViewers: (...a: unknown[]) => mockGetTestViewers(...a) as Promise<unknown>,
    addTestViewer: (...a: unknown[]) => mockAddTestViewer(...a) as Promise<unknown>,
    removeTestViewer: (...a: unknown[]) => mockRemoveTestViewer(...a) as Promise<unknown>,
    // The panel no longer fetches the roster — it searches, through the same
    // endpoint the start-test candidate picker uses.
    searchCandidates: (...a: unknown[]) => mockSearchCandidates(...a) as Promise<unknown>,
  },
}));

// useTimezone reads through a selector; a mock that ignores it hands back the
// whole state and breaks date formatting with "Invalid time zone".
vi.mock('../../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = { user: { id: 'officer-1', timezone: 'America/New_York' } };
    return typeof selector === 'function' ? selector(state) : state;
  }),
}));

import { TestViewersPanel } from './TestViewersPanel';

const CANDIDATE = 'user-candidate';
const EXAMINER = 'user-examiner';

/** What the search endpoint returns: an id and a display name, nothing else. */
const MATCHES = [
  { id: CANDIDATE, name: 'Casey Candidate' },
  { id: EXAMINER, name: 'Erin Examiner' },
  { id: 'user-preceptor', name: 'Pat Preceptor' },
  { id: 'user-captain', name: 'Alex Captain' },
];

const renderPanel = () => render(<TestViewersPanel testId="test-1" candidateId={CANDIDATE} examinerId={EXAMINER} />);

/** Type a fragment and wait for the debounced search to settle. */
async function searchFor(user: ReturnType<typeof userEvent.setup>, fragment: string) {
  await user.type(await screen.findByRole('searchbox'), fragment);
  await waitFor(() => expect(mockSearchCandidates).toHaveBeenCalledWith(fragment));
}

describe('TestViewersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTestViewers.mockResolvedValue([]);
    mockSearchCandidates.mockResolvedValue(MATCHES);
  });

  it('says plainly when nobody extra has access', async () => {
    renderPanel();

    expect(
      await screen.findByText(/nobody outside the candidate, the examiner and your officers/i)
    ).toBeInTheDocument();
  });

  it('lists existing grants with who added them', async () => {
    mockGetTestViewers.mockResolvedValue([
      {
        id: 'grant-1',
        test_id: 'test-1',
        user_id: 'user-preceptor',
        user_name: 'Pat Preceptor',
        granted_by_name: 'Chief Adams',
        granted_at: '2026-08-01T12:00:00Z',
      },
    ]);
    renderPanel();

    expect(await screen.findByText('Pat Preceptor')).toBeInTheDocument();
    expect(screen.getByText(/by Chief Adams/)).toBeInTheDocument();
  });

  // No roster request at all now. The old panel pulled every member into a
  // <select>, which both scanned badly and asked for far more than naming one
  // person needs.
  it('searches rather than listing the roster', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('searchbox');

    expect(mockSearchCandidates).not.toHaveBeenCalled();
    await searchFor(user, 'pat');
    expect(await screen.findByRole('button', { name: /pat preceptor/i })).toBeInTheDocument();
  });

  it('prompts instead of reporting no matches while the query is too short', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(await screen.findByRole('searchbox'), 'p');

    expect(await screen.findByText(/type at least 2 characters/i)).toBeInTheDocument();
    expect(mockSearchCandidates).not.toHaveBeenCalled();
  });

  // The candidate already sees the result as policy allows and the API rejects
  // granting to them; the examiner always sees what they recorded, so a grant
  // would be a no-op the officer could not tell had done nothing.
  it('excludes the candidate and the examiner from the results', async () => {
    const user = userEvent.setup();
    renderPanel();
    await searchFor(user, 'ca');

    expect(await screen.findByRole('button', { name: /alex captain/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /casey candidate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /erin examiner/i })).not.toBeInTheDocument();
  });

  it('excludes anyone who already holds a grant', async () => {
    mockGetTestViewers.mockResolvedValue([
      { id: 'g1', test_id: 'test-1', user_id: 'user-preceptor', user_name: 'Pat Preceptor' },
    ]);
    const user = userEvent.setup();
    renderPanel();
    await searchFor(user, 'pa');

    expect(await screen.findByRole('button', { name: /alex captain/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add pat preceptor/i })).not.toBeInTheDocument();
  });

  it('grants access when a match is picked', async () => {
    const user = userEvent.setup();
    mockAddTestViewer.mockResolvedValue({
      id: 'g-new',
      test_id: 'test-1',
      user_id: 'user-preceptor',
      user_name: 'Pat Preceptor',
    });
    renderPanel();
    await searchFor(user, 'pat');

    await user.click(await screen.findByRole('button', { name: /pat preceptor/i }));

    await waitFor(() => expect(mockAddTestViewer).toHaveBeenCalledWith('test-1', 'user-preceptor'));
    expect(await screen.findByRole('button', { name: /remove pat preceptor/i })).toBeInTheDocument();
  });

  it('clears the search after a grant so the next name starts fresh', async () => {
    const user = userEvent.setup();
    mockAddTestViewer.mockResolvedValue({
      id: 'g-new',
      test_id: 'test-1',
      user_id: 'user-preceptor',
      user_name: 'Pat Preceptor',
    });
    renderPanel();
    await searchFor(user, 'pat');
    await user.click(await screen.findByRole('button', { name: /pat preceptor/i }));

    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue(''));
  });

  it('withdraws access', async () => {
    const user = userEvent.setup();
    mockGetTestViewers.mockResolvedValue([
      { id: 'g1', test_id: 'test-1', user_id: 'user-preceptor', user_name: 'Pat Preceptor' },
    ]);
    mockRemoveTestViewer.mockResolvedValue(undefined);
    renderPanel();

    await user.click(await screen.findByRole('button', { name: /remove pat preceptor/i }));

    await waitFor(() => expect(mockRemoveTestViewer).toHaveBeenCalledWith('test-1', 'user-preceptor'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /remove pat preceptor/i })).not.toBeInTheDocument()
    );
  });

  it('says so when a search matches nobody grantable', async () => {
    mockSearchCandidates.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPanel();
    await searchFor(user, 'zz');

    expect(await screen.findByText(/no members match/i)).toBeInTheDocument();
  });

  it('reports a failed search rather than an empty list that reads as no matches', async () => {
    mockSearchCandidates.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    renderPanel();
    await searchFor(user, 'pat');

    expect(await screen.findByText('Network Error')).toBeInTheDocument();
  });

  it('surfaces a load failure instead of showing an empty list', async () => {
    // getErrorMessage prefers the real message over the fallback, so assert on
    // what actually reaches the officer rather than on the fallback string.
    mockGetTestViewers.mockRejectedValue(new Error('Network Error'));
    renderPanel();

    expect(await screen.findByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  // The grant confers the candidate's view, not the officer's — the panel has
  // to say so, or an officer may believe they are handing out full access.
  it('states that a viewer never sees more than the candidate', async () => {
    renderPanel();

    expect(await screen.findByText(/never more/i)).toBeInTheDocument();
  });
});
