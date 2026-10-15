/**
 * The record-keeping panels as the detail page mounts them: who sees which
 * controls at which status, and that the download goes through the client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';

const mockGetMinutes = vi.fn();
const mockDownloadPdf = vi.fn();
const mockSave = vi.fn();
const mockVerify = vi.fn();
const authState = { checkPermission: (_p: string) => true, user: { id: 'user-secretary' } };

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
    downloadPdf: (...a: unknown[]) => mockDownloadPdf(...a) as unknown,
    getElectionResults: () => Promise.resolve([]),
    getAttachments: () => Promise.resolve([]),
    getRevisions: () => Promise.resolve([]),
    verify: (...a: unknown[]) => mockVerify(...a) as unknown,
    getOpenActionItems: () => Promise.resolve([]),
  },
}));

vi.mock('../../../utils/saveBlob', () => ({
  saveBlob: (...a: unknown[]) => mockSave(...a) as unknown,
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
  status: 'draft',
  updated_at: '2026-10-02T00:00:00Z',
  attendees: [
    { name: 'Alex Adams', status: 'present', present: true },
    { name: 'Blake Brown', status: 'excused', present: false },
  ],
  sections: [],
  motions: [],
  action_items: [],
};

/** The record-keeping panels start folded; open the ones a test looks inside. */
const openPanels = async (user: ReturnType<typeof userEvent.setup>) => {
  for (const name of [/^Action Items/, /^Election results/, /^Attachments/]) {
    await user.click(await screen.findByRole('button', { name }));
  }
};

describe('MinutesDetailPage record keeping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMinutes.mockReset();
    mockDownloadPdf.mockReset();
    mockVerify.mockReset();
    mockVerify.mockResolvedValue({ verified: true, version: 1, changed: [], detail: 'ok' });
    mockGetMinutes.mockResolvedValue(base);
  });

  it('opens on the minutes: the record panels start folded, each with its count', async () => {
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByText('1 present · 1 excused');
    for (const name of ['Motions (0)', 'Action Items (0)', 'Closed sessions (0)']) {
      expect(await screen.findByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('unfolds the approved-versions panel and flags it when the record no longer matches', async () => {
    mockGetMinutes.mockResolvedValue({ ...base, status: 'approved' });
    mockVerify.mockResolvedValue({
      verified: false,
      version: 1,
      changed: ['sections'],
      detail: 'These minutes no longer match the version that was approved.',
    });
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Approved versions/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the roll call by status', async () => {
    renderWithRouter(<MinutesDetailPage />);
    expect(await screen.findByText('1 present · 1 excused')).toBeInTheDocument();
  });

  it('lets a manager edit attendance and carry items forward while the minutes are a draft', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    expect(await screen.findByRole('button', { name: 'Edit attendance' })).toBeInTheDocument();
    await openPanels(user);
    expect(screen.getByRole('button', { name: 'Carry forward open items' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'File an election result' })).toBeInTheDocument();
    expect(await screen.findByLabelText('File')).toBeInTheDocument();
  });

  it('locks the roll call, carry-forward and election filing once approved, leaving only the signed copy', async () => {
    mockGetMinutes.mockResolvedValue({ ...base, status: 'approved' });
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: /^Approved versions/ }));
    expect(await screen.findByText('These minutes match version 1 as it was approved.')).toBeInTheDocument();
    await openPanels(user);
    expect(screen.queryByRole('button', { name: 'Edit attendance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carry forward open items' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'File signed copy' })).toBeInTheDocument();
    // An election can close after adoption; its result is still filed, as an addendum.
    expect(screen.getByRole('button', { name: 'File an election result' })).toBeInTheDocument();
  });

  it('gives a plain member no controls over any of it', async () => {
    authState.checkPermission = (p: string) => p !== 'minutes.manage';
    try {
      mockGetMinutes.mockResolvedValue({ ...base, status: 'approved' });
      renderWithRouter(<MinutesDetailPage />);

      await screen.findByText('1 present · 1 excused');
      await screen.findByText('These minutes match version 1 as it was approved.');
      expect(screen.queryByRole('button', { name: 'Edit attendance' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    } finally {
      authState.checkPermission = () => true;
    }
  });

  it('downloads the printable copy through the client under the minutes’ title', async () => {
    const blob = new Blob(['%PDF']);
    mockDownloadPdf.mockResolvedValue(blob);
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);

    await user.click(await screen.findByRole('button', { name: 'Download PDF' }));

    expect(mockDownloadPdf).toHaveBeenCalledWith(MINUTES_ID);
    await vi.waitFor(() => expect(mockSave).toHaveBeenCalledWith(blob, 'October Business Meeting.pdf'));
  });
});
