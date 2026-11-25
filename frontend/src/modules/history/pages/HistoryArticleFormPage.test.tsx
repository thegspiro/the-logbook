import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ArticleFullView } from '../types';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetArticle = vi.fn();
const mockListMedia = vi.fn();
const mockNavigate = vi.fn();
vi.mock('../services/api', () => ({
  historyArticleService: {
    createArticle: (...args: unknown[]) => mockCreate(...args) as unknown,
    updateArticle: (...args: unknown[]) => mockUpdate(...args) as unknown,
    getArticle: (...args: unknown[]) => mockGetArticle(...args) as unknown,
  },
  historyMediaService: { listMedia: (...args: unknown[]) => mockListMedia(...args) as unknown },
  historyDocumentService: { listDocuments: vi.fn() },
  historyEventService: { listEvents: vi.fn() },
  historyApparatusService: { listApparatus: vi.fn() },
  historyService: { listPeople: vi.fn() },
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
}));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import HistoryArticleFormPage from './HistoryArticleFormPage';

const cover = {
  id: 'c1',
  kind: 'photo' as const,
  title: 'The station in 1920',
  taken_date: null,
  taken_date_precision: 'year' as const,
  taken_date_circa: false,
  duration_seconds: null,
  has_thumbnail: true,
  publication_level: 'public' as const,
};

const saved = { id: 'ar1' };

const existing: ArticleFullView = {
  view: 'full',
  id: 'ar1',
  title: 'The station',
  subtitle: 'A century on Elm Street',
  byline: 'Hannah',
  summary: 'Its story.',
  cover,
  cover_media_id: 'c1',
  citations: ['A book'],
  publication_level: 'members',
  updated_at: '2026-11-22T12:00:00Z',
  blocks: [{ id: 'b1', kind: 'text', html: '<p>Built in 1920.</p>', media: null, caption: null, size: 'full' }],
  members: [],
  events: [],
  apparatus: [],
  documents: [],
  sources: [],
  research_notes: null,
  published_at: '2026-11-22T12:00:00Z',
  revision_number: 2,
  public_revision_number: null,
  public_changes_pending: false,
  photos_not_public: [],
  clearance_required: false,
  cleared_for_public: false,
  clearance: null,
  can_edit: true,
  can_publish: true,
  created_at: '2026-11-22T12:00:00Z',
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/history/articles/new" element={<HistoryArticleFormPage />} />
        <Route path="/history/articles/:articleId/edit" element={<HistoryArticleFormPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('HistoryArticleFormPage', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(saved);
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue(saved);
    mockGetArticle.mockReset();
    mockGetArticle.mockResolvedValue(existing);
    mockListMedia.mockReset();
    mockListMedia.mockResolvedValue({ items: [cover], total: 1 });
    mockNavigate.mockReset();
  });

  it('saves a new article as a draft with its cover and a reference, leaving the byline to the server', async () => {
    renderAt('/history/articles/new');
    await userEvent.type(screen.getByRole('textbox', { name: /^Title/ }), 'The station');
    await userEvent.click(screen.getByRole('button', { name: 'Choose a cover photo' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Choose The station in 1920' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a reference' }));
    await userEvent.type(screen.getByLabelText('Reference 1'), 'The Courier, 1920');
    await userEvent.click(screen.getByRole('button', { name: 'Save as a draft' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'The station',
        byline: undefined,
        cover_media_id: 'c1',
        citations: ['The Courier, 1920'],
        blocks: [],
        member_ids: [],
      })
    );
    expect(mockNavigate).toHaveBeenCalledWith('/history/articles/ar1');
  });

  it('sends a cleared subtitle, byline and cover as null on an edit, with the body', async () => {
    renderAt('/history/articles/ar1/edit');
    const subtitle = await screen.findByLabelText('Subtitle');
    await userEvent.clear(subtitle);
    await userEvent.clear(screen.getByLabelText('Byline'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove the cover' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      'ar1',
      expect.objectContaining({
        subtitle: null,
        byline: null,
        cover_media_id: null,
        citations: ['A book'],
        blocks: [{ kind: 'text', html: '<p>Built in 1920.</p>' }],
        edit_kind: 'minor',
      })
    );
  });
});
