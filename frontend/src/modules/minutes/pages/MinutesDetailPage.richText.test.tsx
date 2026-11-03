/**
 * Editing a section with the rich-text editor, and reading one back: what is
 * sent to the server, how old plain-text sections open, and how each format is
 * shown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const MINUTES_ID = 'minutes-1';

const mockGetMinutes = vi.fn();
const mockUpdateMinutes = vi.fn();
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
    updateMinutes: (...a: unknown[]) => mockUpdateMinutes(...a) as unknown,
    getSuggestions: () => Promise.resolve([]),
    getImportableElections: () => Promise.resolve([]),
    getElectionResults: () => Promise.resolve([]),
    getAttachments: () => Promise.resolve([]),
    getRevisions: () => Promise.resolve([]),
    getClosedSessions: () => Promise.resolve([]),
    verify: () => Promise.resolve({ verified: true, version: 1, changed: [], detail: 'ok' }),
    getOpenActionItems: () => Promise.resolve([]),
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

const draft = {
  id: MINUTES_ID,
  title: 'October Business Meeting',
  meeting_type: 'business',
  meeting_date: '2026-10-02T00:00:00Z',
  status: 'draft',
  updated_at: '2026-10-02T00:00:00Z',
  attendees: [],
  motions: [],
  action_items: [],
  sections: [
    { order: 0, key: 'old_business', title: 'Old Business', content: 'Hose order\n\nNote <5 bids' },
    {
      order: 1,
      key: 'new_business',
      title: 'New Business',
      content: '<h2>Budget</h2><p>Approved <strong>in full</strong></p><script>bad()</script>',
      format: 'html',
    },
    { order: 2, key: 'roll_call', title: 'Roll Call', content: '<p></p>', format: 'html', required: true },
  ],
};

describe('MinutesDetailPage rich-text sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMinutes.mockReset();
    mockUpdateMinutes.mockReset();
    mockGetMinutes.mockResolvedValue(draft);
    mockUpdateMinutes.mockResolvedValue(draft);
  });

  it('shows a plain-text section as typed and a rich one with its structure', async () => {
    renderWithRouter(<MinutesDetailPage />);

    expect(await screen.findByText(/Note <5 bids/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Budget', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('in full').tagName).toBe('STRONG');
    expect(document.body.innerHTML).not.toContain('<script>bad()');
  });

  it('flags a required section that holds only an empty paragraph', async () => {
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByText(/Note <5 bids/);
    expect(screen.getAllByText('Required')).toHaveLength(1);
  });

  it('opens an old plain-text section in the editor as paragraphs, words unchanged', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByText(/Note <5 bids/);

    await user.click(screen.getByRole('button', { name: /Edit.*Old Business|Edit Old Business/ }));

    const editor = await screen.findByRole('textbox', { name: 'Old Business content' });
    expect(editor).toHaveTextContent('Hose order');
    expect(editor).toHaveTextContent('Note <5 bids');
    expect(within(editor).getAllByText(/Hose order|Note <5 bids/)).toHaveLength(2);
  });

  it('saves an edited section as rich text', async () => {
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByText(/Note <5 bids/);

    await user.click(screen.getByRole('button', { name: /Edit.*Old Business|Edit Old Business/ }));
    const editor = await screen.findByRole('textbox', { name: 'Old Business content' });
    await user.type(editor, ' Done');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateMinutes).toHaveBeenCalledTimes(1));
    const [id, payload] = mockUpdateMinutes.mock.calls[0] as [
      string,
      { sections: Array<{ key: string; content: string; format?: string }> },
    ];
    expect(id).toBe(MINUTES_ID);
    const saved = payload.sections.find((s) => s.key === 'old_business');
    expect(saved?.format).toBe('html');
    expect(saved?.content).toContain('Done');
    expect(saved?.content).toContain('Hose order');
    // The second paragraph survives, and its `<` is still text, not markup.
    expect(saved?.content).toContain('&lt;5 bids');
    expect(saved?.content.match(/<p>/g)).toHaveLength(2);
    // The other sections are sent back as they were.
    expect(payload.sections.find((s) => s.key === 'new_business')?.format).toBe('html');
  });

  it('names the version it loaded, and on a conflict keeps the text and offers a reload', async () => {
    // MM5-4: someone else saved after this copy was loaded.
    mockGetMinutes.mockResolvedValue({ ...draft, edit_version: 3 });
    mockUpdateMinutes.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        isAxiosError: true,
        response: {
          status: 409,
          data: { detail: 'Someone else saved these minutes after you opened them.' },
        },
      })
    );
    const user = userEvent.setup();
    renderWithRouter(<MinutesDetailPage />);
    await screen.findByText(/Note <5 bids/);

    await user.click(screen.getByRole('button', { name: /Edit.*Old Business|Edit Old Business/ }));
    const editor = await screen.findByRole('textbox', { name: 'Old Business content' });
    await user.type(editor, ' Mine');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateMinutes).toHaveBeenCalledWith(MINUTES_ID, expect.objectContaining({ expected_version: 3 }))
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(/Someone else saved these minutes/);
    expect(screen.getByRole('textbox', { name: 'Old Business content' })).toHaveTextContent('Mine');

    mockGetMinutes.mockResolvedValue({ ...draft, edit_version: 4 });
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
