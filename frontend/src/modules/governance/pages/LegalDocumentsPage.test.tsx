import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithRouter } from '../../../test/utils';
import type { LegalDocumentsOverview } from '../types/legal';

const mockGetOverview = vi.fn();
const mockCreateRevision = vi.fn();
const mockPublishRevision = vi.fn();
const mockDeleteRevision = vi.fn();
const mockRevertToDefault = vi.fn();
const mockUpdateRevision = vi.fn();

vi.mock('../services/api', () => ({
  legalDocumentsService: {
    getOverview: () => mockGetOverview() as unknown,
    createRevision: (...args: unknown[]) => mockCreateRevision(...args) as unknown,
    updateRevision: (...args: unknown[]) => mockUpdateRevision(...args) as unknown,
    deleteRevision: (...args: unknown[]) => mockDeleteRevision(...args) as unknown,
    publishRevision: (...args: unknown[]) => mockPublishRevision(...args) as unknown,
    revertToDefault: (...args: unknown[]) => mockRevertToDefault(...args) as unknown,
  },
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
      history: [],
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
      history: [],
    },
  ],
  ...partial,
});

describe('LegalDocumentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLegalDocumentsStore.setState({ overview: null, isLoading: false, isSaving: false, error: null });
    mockGetOverview.mockResolvedValue(overview());
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

  it('lists proposals with their author and reason', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft] } : d
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
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft] } : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByText('Dana Reyes proposed this');
    await user.click(screen.getByRole('button', { name: /Publish to members/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/replaces what every visitor/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Publish it' }));

    await waitFor(() => expect(mockPublishRevision).toHaveBeenCalledWith('rev-1'));
  });

  it('hides publishing controls from a member who can only propose', async () => {
    mockGetOverview.mockResolvedValue(
      overview({
        canPublish: false,
        documents: overview().documents.map((d) =>
          d.documentType === 'privacy_policy' ? { ...d, drafts: [draft] } : d
        ),
      })
    );
    renderWithRouter(<LegalDocumentsPage />);
    await screen.findByText('Dana Reyes proposed this');
    expect(screen.queryByRole('button', { name: /Publish to members/ })).not.toBeInTheDocument();
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
});
