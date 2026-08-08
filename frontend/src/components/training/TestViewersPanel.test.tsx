import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetTestViewers = vi.fn();
const mockAddTestViewer = vi.fn();
const mockRemoveTestViewer = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../../services/api', () => ({
  skillsTestingService: {
    getTestViewers: (...a: unknown[]) => mockGetTestViewers(...a) as Promise<unknown>,
    addTestViewer: (...a: unknown[]) => mockAddTestViewer(...a) as Promise<unknown>,
    removeTestViewer: (...a: unknown[]) => mockRemoveTestViewer(...a) as Promise<unknown>,
  },
  userService: {
    getUsers: () => mockGetUsers() as Promise<unknown>,
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

const MEMBERS = [
  { id: CANDIDATE, first_name: 'Casey', last_name: 'Candidate', username: 'casey' },
  { id: EXAMINER, first_name: 'Erin', last_name: 'Examiner', username: 'erin' },
  { id: 'user-preceptor', first_name: 'Pat', last_name: 'Preceptor', username: 'pat' },
  { id: 'user-captain', first_name: 'Alex', last_name: 'Captain', username: 'alex' },
];

const renderPanel = () => render(<TestViewersPanel testId="test-1" candidateId={CANDIDATE} examinerId={EXAMINER} />);

describe('TestViewersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTestViewers.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue(MEMBERS);
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

  // The candidate already sees the result as policy allows and the API rejects
  // granting to them; the examiner always sees what they recorded, so a grant
  // would be a no-op the officer could not tell had done nothing.
  it('excludes the candidate and the examiner from the picker', async () => {
    renderPanel();
    await screen.findByRole('combobox');

    expect(screen.queryByRole('option', { name: 'Casey Candidate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Erin Examiner' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pat Preceptor' })).toBeInTheDocument();
  });

  it('excludes anyone who already holds a grant', async () => {
    mockGetTestViewers.mockResolvedValue([
      { id: 'g1', test_id: 'test-1', user_id: 'user-preceptor', user_name: 'Pat Preceptor' },
    ]);
    renderPanel();
    await screen.findByRole('combobox');

    expect(screen.queryByRole('option', { name: 'Pat Preceptor' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alex Captain' })).toBeInTheDocument();
  });

  it('grants access to the selected member', async () => {
    const user = userEvent.setup();
    mockAddTestViewer.mockResolvedValue({
      id: 'g-new',
      test_id: 'test-1',
      user_id: 'user-preceptor',
      user_name: 'Pat Preceptor',
    });
    renderPanel();

    await user.selectOptions(await screen.findByRole('combobox'), 'user-preceptor');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(mockAddTestViewer).toHaveBeenCalledWith('test-1', 'user-preceptor'));
    expect(await screen.findByText('Pat Preceptor')).toBeInTheDocument();
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
    // The grant row goes; the name reappears as a picker option, because they
    // are grantable again. Asserting on the name alone would match that.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /remove pat preceptor/i })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('option', { name: 'Pat Preceptor' })).toBeInTheDocument();
  });

  it('cannot submit with nobody selected', async () => {
    renderPanel();
    await screen.findByRole('combobox');

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
  });

  it('hides the picker when there is nobody left to add', async () => {
    mockGetUsers.mockResolvedValue([MEMBERS[0], MEMBERS[1]]);
    renderPanel();

    expect(await screen.findByText(/everyone else in the department already has access/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('surfaces a load failure instead of showing an empty list', async () => {
    // getErrorMessage prefers the real message over the fallback, so assert on
    // what actually reaches the officer rather than on the fallback string.
    mockGetTestViewers.mockRejectedValue(new Error('Network Error'));
    renderPanel();

    expect(await screen.findByText('Network Error')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  // The grant confers the candidate's view, not the officer's — the panel has
  // to say so, or an officer may believe they are handing out full access.
  it('states that a viewer never sees more than the candidate', async () => {
    renderPanel();

    expect(await screen.findByText(/never more/i)).toBeInTheDocument();
  });
});
