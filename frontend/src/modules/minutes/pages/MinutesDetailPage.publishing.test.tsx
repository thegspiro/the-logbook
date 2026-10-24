/**
 * Publishing from the minutes page: the status line comes from the server,
 * publishing says whether a public copy was posted, and the public copy can be
 * taken down on its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';

const mockGetMinutes = vi.fn();
const mockPublish = vi.fn();
const mockStatus = vi.fn();
const mockWithdraw = vi.fn();
const authState = {
  checkPermission: () => true,
  user: { id: 'user-chief' } as { id: string } | undefined,
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
    publishMinutes: (...a: unknown[]) => mockPublish(...a) as unknown,
    getPublishingStatus: (...a: unknown[]) => mockStatus(...a) as unknown,
    withdrawPublicCopy: (...a: unknown[]) => mockWithdraw(...a) as unknown,
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

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import MinutesDetailPage from './MinutesDetailPage';
import { renderWithRouter } from '../../../test/utils';

const approved = {
  id: MINUTES_ID,
  title: 'Minutes: October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'approved',
  sections: [],
  motions: [],
  action_items: [],
};

const noCopies = {
  library_allowed: true,
  library_published: false,
  library_version: null,
  library_published_at: null,
  public_allowed: false,
  public_posted: false,
  public_withdrawn: false,
  public_version: null,
  public_posted_at: null,
  public_replaced_version: null,
  public_under_correction: false,
  public_copy_id: null,
};

const posted = {
  ...noCopies,
  library_published: true,
  library_version: 1,
  public_allowed: true,
  public_posted: true,
  public_version: 1,
  public_copy_id: 'copy-1',
};

describe('MinutesDetailPage publishing', () => {
  beforeEach(() => {
    mockGetMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(approved);
    mockStatus.mockReset();
    mockStatus.mockResolvedValue(noCopies);
    mockPublish.mockReset();
    mockPublish.mockResolvedValue({ public_allowed: false, public_posted: false });
    mockWithdraw.mockReset();
    mockWithdraw.mockResolvedValue(undefined);
    authState.checkPermission = () => true;
  });

  it('says public posting is off when the department has it off', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText(/Not posted publicly/)).toBeInTheDocument();
    expect(mockStatus).toHaveBeenCalledWith(MINUTES_ID);
  });

  it('publishes and re-reads where the minutes now stand', async () => {
    const user = userEvent.setup();
    mockStatus.mockResolvedValueOnce({ ...noCopies, public_allowed: true });
    mockPublish.mockResolvedValue({ public_allowed: true, public_posted: true });
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Publishing will also post a public copy.')).toBeInTheDocument();
    mockStatus.mockResolvedValue(posted);
    await user.click(screen.getByRole('button', { name: 'Publish to Documents' }));

    expect(mockPublish).toHaveBeenCalledWith(MINUTES_ID);
    expect(await screen.findByRole('link', { name: 'public minutes page' })).toHaveAttribute(
      'href',
      '/public/minutes/copy-1'
    );
  });

  it('takes the public copy down after a confirmation', async () => {
    const user = userEvent.setup();
    mockStatus.mockResolvedValue(posted);
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Take the public copy down' }));
    await user.click(await screen.findByRole('button', { name: 'Take it down' }));

    expect(mockWithdraw).toHaveBeenCalledWith(MINUTES_ID);
  });

  it('leaves the public copy up when the confirmation is declined', async () => {
    const user = userEvent.setup();
    mockStatus.mockResolvedValue(posted);
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Take the public copy down' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it up' }));

    expect(mockWithdraw).not.toHaveBeenCalled();
  });

  it('does not ask for the status without the manage permission', async () => {
    authState.checkPermission = () => false;
    renderWithRouter(<MinutesDetailPage />);

    await screen.findByText('Minutes: October Business Meeting');
    expect(mockStatus).not.toHaveBeenCalled();
  });
});
