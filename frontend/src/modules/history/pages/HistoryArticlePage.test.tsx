import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { ArticleFullView, ArticleMemberView } from '../types';

const mockGetArticle = vi.fn();
const mockExport = vi.fn();
const mockListRevisions = vi.fn();
const mockSaveBlob = vi.fn();
vi.mock('../services/api', () => ({
  historyArticleService: {
    getArticle: (...args: unknown[]) => mockGetArticle(...args) as unknown,
    exportArticle: (...args: unknown[]) => mockExport(...args) as unknown,
    listRevisions: (...args: unknown[]) => mockListRevisions(...args) as unknown,
  },
  historyService: {},
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
  documentFileUrl: (id: string, which: string) => `/api/v1/history/documents/${id}/${which}`,
}));
vi.mock('../../../utils/saveBlob', () => ({
  saveBlob: (...args: unknown[]) => mockSaveBlob(...args) as unknown,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryArticlePage from './HistoryArticlePage';

const ruins = {
  id: 'm1',
  kind: 'photo' as const,
  title: 'The ruins',
  taken_date: null,
  taken_date_precision: 'year' as const,
  taken_date_circa: false,
  duration_seconds: null,
  has_thumbnail: true,
  publication_level: 'members' as const,
};

const memberView = (overrides: Partial<ArticleMemberView> = {}): ArticleMemberView => ({
  view: 'member',
  id: 'ar1',
  title: 'The mill fire',
  subtitle: 'Mill Street, 1911',
  byline: 'Hannah Historian',
  summary: 'How the department met its largest fire.',
  cover: null,
  citations: ['The Smallville Courier, 5 March 1911'],
  publication_level: 'members',
  updated_at: '2026-11-22T12:00:00Z',
  blocks: [
    {
      id: 'b1',
      kind: 'text',
      html: '<h2>The alarm</h2><p>It began at <strong>night</strong>.</p>',
      media: null,
      caption: null,
      size: 'full',
    },
    { id: 'b2', kind: 'photo', html: null, media: ruins, caption: 'Next morning', size: 'half' },
  ],
  members: [{ member_id: 'p1', display_name: 'John Smith' }],
  events: [],
  apparatus: [],
  documents: [],
  sources: [{ kind: 'photo', id: 'm1', title: 'The ruins' }],
  ...overrides,
});

const fullView = (overrides: Partial<ArticleFullView> = {}): ArticleFullView => ({
  ...memberView(),
  view: 'full',
  cover_media_id: null,
  research_notes: 'Mrs Jones told me in 1990',
  published_at: null,
  revision_number: 1,
  public_revision_number: null,
  public_changes_pending: false,
  photos_not_public: ['The ruins'],
  clearance_required: true,
  cleared_for_public: false,
  clearance: null,
  can_edit: true,
  can_publish: true,
  created_at: '2026-11-22T12:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/articles/ar1']}>
        <Routes>
          <Route path="/history/articles/:articleId" element={<HistoryArticlePage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryArticlePage', () => {
  beforeEach(() => {
    mockGetArticle.mockReset();
    mockExport.mockReset();
    mockExport.mockResolvedValue(new Blob(['%PDF']));
    mockListRevisions.mockReset();
    mockListRevisions.mockResolvedValue([]);
    mockSaveBlob.mockReset();
  });

  it('shows a member the article, its photo and its sources, and nothing of the Historian’s', async () => {
    mockGetArticle.mockResolvedValue(memberView());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'The mill fire' })).toBeInTheDocument();
    expect(screen.getByText('By Hannah Historian')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The alarm' })).toBeInTheDocument();
    expect(screen.getByText('night').tagName).toBe('STRONG');
    expect(screen.getByRole('img', { name: 'Next morning' })).toHaveAttribute('src', '/api/v1/history/media/m1/view');
    expect(screen.getByRole('link', { name: 'John Smith' })).toHaveAttribute('href', '/history/people/p1');
    expect(screen.getByText('The Smallville Courier, 5 March 1911')).toBeInTheDocument();
    expect(screen.queryByText(/Mrs Jones/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument();
  });

  it('lets anyone who can read it download it as PDF or Word', async () => {
    mockGetArticle.mockResolvedValue(memberView());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Word' }));
    expect(mockExport).toHaveBeenCalledWith('ar1', 'docx');
    await waitFor(() => expect(mockSaveBlob).toHaveBeenCalledWith(expect.any(Blob), 'the_mill_fire.docx'));
    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(mockExport).toHaveBeenLastCalledWith('ar1', 'pdf');
  });

  it('tells the Historian which photos stand in the way of public clearance', async () => {
    mockGetArticle.mockResolvedValue(fullView());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Photos not cleared for the public' })).toBeInTheDocument();
    expect(screen.getByText('Mrs Jones told me in 1990')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit/ })).toHaveAttribute('href', '/history/articles/ar1/edit');
  });

  it('shows the Historian a photo that is gone as a gap to fix', async () => {
    mockGetArticle.mockResolvedValue(
      fullView({
        photos_not_public: [],
        blocks: [{ id: 'b2', kind: 'photo', html: null, media: null, media_id: null, caption: 'Gone', size: 'full' }],
      })
    );
    renderPage();
    expect(await screen.findByText(/no longer in the archive or no longer published/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Photos not cleared for the public' })).not.toBeInTheDocument();
  });
});
