import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createMockApiError, renderWithRouter } from '../../../test/utils';
import type { LegalDocumentsOverview } from '../types/legal';

const mockGetOverview = vi.fn();
const mockCreateRevision = vi.fn();
const mockPublishRevision = vi.fn();
const mockDeleteRevision = vi.fn();
const mockRevertToDefault = vi.fn();
const mockUpdateRevision = vi.fn();
const mockListRevisions = vi.fn();

vi.mock('../services/api', () => ({
  legalDocumentsService: {
    getOverview: () => mockGetOverview() as unknown,
    createRevision: (...args: unknown[]) => mockCreateRevision(...args) as unknown,
    updateRevision: (...args: unknown[]) => mockUpdateRevision(...args) as unknown,
    deleteRevision: (...args: unknown[]) => mockDeleteRevision(...args) as unknown,
    publishRevision: (...args: unknown[]) => mockPublishRevision(...args) as unknown,
    revertToDefault: (...args: unknown[]) => mockRevertToDefault(...args) as unknown,
    listRevisions: (...args: unknown[]) => mockListRevisions(...args) as unknown,
  },
}));

const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => mockToastError(...args) as unknown },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'user-1', timezone: 'America/New_York' } }),
}));

import LegalDocumentsPage from './LegalDocumentsPage';
import { useLegalDocumentsStore } from '../store/legalDocumentsStore';

const draft = {
  id: 'rev-1',
  documentType: 'privacy_policy' as const,
  status: 'draft' as const,
  body: 'Our department wording.',
  changeNote: 'Adds the retention window from our state schedule.',
  effectiveDate: 'March 3, 2026',
  createdBy: 'user-1',
  createdByName: 'Dana Reyes',
  publishedBy: null,
  publishedByName: null,
  publishedAt: null,
  createdAt: '2026-08-18T12:00:00Z',
  updatedAt: '2026-08-18T12:00:00Z',
};

const overview = (partial: Partial<LegalDocumentsOverview> = {}): LegalDocumentsOverview => ({
  organizationName: 'Falls Church VFD',
  canPublish: true,
  documents: [
    {
      documentType: 'privacy_policy',
      publicPath: '/privacy',
      usingPlatformDefault: true,
      publishedBody: null,
      publishedEffectiveDate: null,
      publishedAt: null,
      publishedByName: null,
      drafts: [],
      draftsTotal: 0,
      history: [],
      historyTotal: 0,
    },
    {
      documentType: 'terms_of_service',
      publicPath: '/terms',
      usingPlatformDefault: true,
      publishedBody: null,
      publishedEffectiveDate: null,
      publishedAt: null,
      publishedByName: null,
      drafts: [],
      draftsTotal: 0,
      history: [],
      historyTotal: 0,
    },
  ],
  ...partial,
});

describe('LegalDocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLegalDocumentsStore.setState({
      overview: null,
      isLoading: false,
      isSaving: false,
      loadingMore: null,
      error: null,
    });
    mockGetOverview.mockReset();
    mockGetOverview.mockResolvedValue(overview());
    mockListRevisions.mockReset();
  });

  it('shows which document members currently see', async () => {
    renderWithRouter(<LegalDocumentsPage />);
    expect(await screen.findByRole('heading', { name: 'Legal Documents' })).toBeInTheDocument();
    expect(screen.getByText(/The built-in privacy policy is live/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open \/privacy/ })).toHaveAttribute('href', '/privacy');
  });

  it('switches between the two documents', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByRole('heading', { name: 'Legal Documents' });
    await user.click(screen.getByRole('tab', { name: 'Terms of Service' }));
    expect(screen.getByRole('link', { name: /Open \/terms/ })).toHaveAttribute('href', '/terms');
  });

  // W54-2: the tabs controlled nothing a screen reader could find.
  it('names the document on show as the tab panel the selected tab controls', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByRole('heading', { name: 'Legal Documents' });
    await user.click(screen.getByRole('tab', { name: 'Terms of Service' }));

    const panel = screen.getByRole('tabpanel', { name: 'Terms of Service' });
    expect(screen.getByRole('tab', { name: 'Terms of Service' })).toHaveAttribute('aria-controls', panel.id);
  });

  it('seeds a new proposal from the built-in text so it can be edited rather than retyped', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByRole('heading', { name: 'Legal Documents' });
    await user.click(screen.getByRole('button', { name: /Propose a revision/ }));

    const body = await screen.findByLabelText<HTMLTextAreaElement>('Document text');
    // The department-control language is the part a replacement most often
    // drops; it has to arrive in the editor for the drafter to keep it.
    expect(body.value).toContain('holds full control of this application');
    expect(body.value).toContain('Access is based on your status within the department');
    expect(body.value).toContain('Falls Church VFD');
    // `**bold**` markers are stripped: the public page renders custom text as
    // plain paragraphs, so a marker left in would be published literally.
    expect(body.value).not.toContain('**');
  });

  it('refuses to save a proposal with no explanation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByRole('heading', { name: 'Legal Documents' });
    await user.click(screen.getByRole('button', { name: /Propose a revision/ }));
    await user.click(await screen.findByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/what this revision changes and why/i);
    expect(mockCreateRevision).not.toHaveBeenCalled();
  });

  it('saves a proposal as a draft, not to the public page', async () => {
    const user = userEvent.setup();
    mockCreateRevision.mockResolvedValue(draft);
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByRole('heading', { name: 'Legal Documents' });
    await user.click(screen.getByRole('button', { name: /Propose a revision/ }));

    await user.type(await screen.findByLabelText(/What does this change/), 'Matches Article IV.');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(mockCreateRevision).toHaveBeenCalled());
    const payload = mockCreateRevision.mock.calls[0]?.[0] as { documentType: string; changeNote: string };
    expect(payload.documentType).toBe('privacy_policy');
    expect(payload.changeNote).toBe('Matches Article IV.');
    expect(mockPublishRevision).not.toHaveBeenCalled();
  });

  it('tells the member why a proposal over the open-draft cap was refused', async () => {
    const user = userEvent.setup();
    const refusal = 'You already have 10 open proposals for the privacy policy. Publish or withdraw one first.';
    mockCreateRevision.mockReset();
    mockCreateRevision.mockRejectedValue(createMockApiError(refusal, 400));
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByRole('heading', { name: 'Legal Documents' });
    await user.click(screen.getByRole('button', { name: /Propose a revision/ }));

    await user.type(await screen.findByLabelText(/What does this change/), 'Matches Article IV.');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    // The server's reason, not a generic "Could not save": the member has to
    // learn that publishing or withdrawing one of their drafts unblocks them.
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(refusal));
  });

  it('clears the effective date with an explicit null rather than omitting it', async () => {
    const user = userEvent.setup();
    mockUpdateRevision.mockResolvedValue(draft);
    mockGetOverview.mockResolvedValue(
      overview({
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft], draftsTotal: 1 } : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByText('Dana Reyes proposed this');
    await user.click(screen.getByRole('button', { name: /Edit/ }));

    await user.clear(await screen.findByLabelText(/Effective date/));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(mockUpdateRevision).toHaveBeenCalled());
    const [, payload] = mockUpdateRevision.mock.calls[0] as [string, { effectiveDate: unknown }];
    // Omitting the key would be read as "leave it alone" and the old date
    // would survive behind the success toast.
    expect(payload.effectiveDate).toBeNull();
  });

  it('lists proposals with their author and reason', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft], draftsTotal: 1 } : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    expect(await screen.findByText('Dana Reyes proposed this')).toBeInTheDocument();
    expect(screen.getByText('Adds the retention window from our state schedule.')).toBeInTheDocument();
  });

  it('publishes only after the confirmation is accepted', async () => {
    const user = userEvent.setup();
    mockPublishRevision.mockResolvedValue({ ...draft, status: 'published' });
    mockGetOverview.mockResolvedValue(
      overview({
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft], draftsTotal: 1 } : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByText('Dana Reyes proposed this');
    await user.click(screen.getByRole('button', { name: 'Publish' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Everyone who visits \/privacy sees this text immediately/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Publish it' }));

    await waitFor(() => expect(mockPublishRevision).toHaveBeenCalledWith('rev-1'));
  });

  it('hides publishing controls from a member who can only propose', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        canPublish: false,
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft], draftsTotal: 1 } : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByText('Dana Reyes proposed this');
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    // A proposer still owns their own draft.
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
  });

  it('offers revert only when the department has published its own text', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy'
            ? {
                ...d,
                usingPlatformDefault: false,
                publishedBody: 'Our published notice.',
                publishedEffectiveDate: 'March 3, 2026',
                publishedByName: 'Chief Alvarez',
              }
            : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    expect(await screen.findByRole('button', { name: /Revert to the built-in text/ })).toBeInTheDocument();
    expect(screen.getByText(/Falls Church VFD publishes its own wording/)).toBeInTheDocument();
  });
  // DOC-8: the overview carries one page of each list and its total.
  describe('loading more', () => {
    const older = { ...draft, id: 'rev-2', createdByName: 'Sam Ortiz', changeNote: 'An older proposal.' };

    beforeEach(() => {
      mockGetOverview.mockResolvedValue(
        overview({
          documents: overview().documents.map((d) =>
            d.documentType === 'privacy_policy' ? { ...d, drafts: [draft], draftsTotal: 2 } : d
          ),
        })
      );
      mockListRevisions.mockResolvedValue({ items: [older], total: 2, offset: 1, limit: 10 });
    });

    it('counts every proposal and offers the rest', async () => {
      renderWithRouter(<LegalDocumentsPage />);
      expect(await screen.findByRole('heading', { name: 'Proposed revisions (2)' })).toBeInTheDocument();
      expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
    });

    it('appends the next page and then stops offering more', async () => {
      const user = userEvent.setup();
      renderWithRouter(<LegalDocumentsPage />);
      await user.click(await screen.findByRole('button', { name: 'Load more proposals' }));

      expect(mockListRevisions).toHaveBeenCalledWith('privacy_policy', 'drafts', 1);
      expect(await screen.findByText('Sam Ortiz proposed this')).toBeInTheDocument();
      expect(screen.getByText('Dana Reyes proposed this')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Load more proposals' })).not.toBeInTheDocument();
    });

    it('offers nothing more when the first page is everything', async () => {
      mockGetOverview.mockResolvedValue(
        overview({
          documents: overview().documents.map((d) =>
            d.documentType === 'privacy_policy' ? { ...d, drafts: [draft], draftsTotal: 1 } : d
          ),
        })
      );
      renderWithRouter(<LegalDocumentsPage />);
      await screen.findByText('Dana Reyes proposed this');
      expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
    });
  });
});
