import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { EventFullView, EventMemberView } from '../types';

const mockGetEvent = vi.fn();
const mockPublish = vi.fn();
const mockListRevisions = vi.fn();

const mockRelatedArticles = vi.fn((..._args: unknown[]) => Promise.resolve([] as unknown[]));
vi.mock('../services/api', () => ({
  // The page's Articles section; none here unless a test says so.
  historyArticleService: { relatedTo: (...args: unknown[]) => mockRelatedArticles(...args) as unknown },
  historyEventService: {
    getEvent: (...args: unknown[]) => mockGetEvent(...args) as unknown,
    publish: (...args: unknown[]) => mockPublish(...args) as unknown,
    listRevisions: (...args: unknown[]) => mockListRevisions(...args) as unknown,
  },
  historyService: {},
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
  documentFileUrl: (id: string, which: string) => `/api/v1/history/documents/${id}/${which}`,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryEventPage from './HistoryEventPage';

const base = {
  id: 'e1',
  title: 'Mill fire',
  start_date: '1911-03-04',
  start_precision: 'day' as const,
  start_circa: false,
  end_date: '1911-03-06',
  end_precision: 'day' as const,
  end_circa: false,
  place: 'Mill Street',
  station_name: 'Central Station',
  event_type_name: 'Fire or incident',
  description: 'Three days of fire at the mill.',
  station_id: 's1',
  event_type_id: 't1',
  source_id: null,
  source_name: null,
  members: [{ member_id: 'p1', display_name: 'John Smith', role: 'commanded' }],
  apparatus: [{ apparatus_id: 'a1', name: '1924 Ahrens-Fox' }],
  media: [],
  documents: [],
};

const memberView = (): EventMemberView => ({ ...base, view: 'member', publication_level: 'members' });

const fullView = (overrides: Partial<EventFullView> = {}): EventFullView => ({
  ...base,
  view: 'full',
  publication_level: 'draft',
  research_notes: 'A civilian was rescued from the third floor',
  published_at: null,
  revision_number: 1,
  public_revision_number: null,
  public_changes_pending: false,
  clearance_required: true,
  cleared_for_public: false,
  clearance: null,
  can_edit: true,
  can_publish: true,
  created_at: '2026-11-21T12:00:00Z',
  updated_at: '2026-11-21T12:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/events/e1']}>
        <Routes>
          <Route path="/history/events/:eventId" element={<HistoryEventPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryEventPage', () => {
  beforeEach(() => {
    mockGetEvent.mockReset();
    mockPublish.mockReset();
    mockListRevisions.mockReset();
    mockListRevisions.mockResolvedValue([]);
    mockRelatedArticles.mockReset();
    mockRelatedArticles.mockResolvedValue([]);
  });

  it('shows a member the event, its people with their roles, and nothing of the Historian’s', async () => {
    mockGetEvent.mockResolvedValue(memberView());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Mill fire' })).toBeInTheDocument();
    expect(screen.getByText('Mar 4, 1911 – Mar 6, 1911')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'John Smith' })).toHaveAttribute('href', '/history/people/p1');
    expect(screen.getByText('commanded')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1924 Ahrens-Fox' })).toHaveAttribute('href', '/history/apparatus/a1');
    expect(screen.queryByText(/civilian was rescued/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument();
  });

  it('gives the Historian the research notes and holds public until cleared', async () => {
    mockGetEvent.mockResolvedValue(fullView());
    mockPublish.mockResolvedValue(fullView({ publication_level: 'members' }));
    renderPage();
    expect(await screen.findByText('A civilian was rescued from the third floor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish to the public' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Publish to members' }));
    expect(mockPublish).toHaveBeenCalledWith('e1', 'members');
  });

  it('lists the articles that tell of the event, and shows no Articles section when there are none', async () => {
    mockGetEvent.mockResolvedValue(memberView());
    mockRelatedArticles.mockResolvedValue([
      {
        id: 'ar1',
        title: 'The night the mill burned',
        subtitle: null,
        byline: 'Hannah',
        summary: null,
        cover: null,
        publication_level: 'members',
        updated_at: '2026-11-22T12:00:00Z',
      },
    ]);
    renderPage();
    expect(await screen.findByRole('link', { name: 'The night the mill burned' })).toHaveAttribute(
      'href',
      '/history/articles/ar1'
    );
    expect(screen.getByRole('heading', { name: 'Articles' })).toBeInTheDocument();
    expect(mockRelatedArticles).toHaveBeenCalledWith(expect.objectContaining({ event_id: 'e1' }));
  });

  it('leaves the Articles section out for an event no article mentions', async () => {
    mockGetEvent.mockResolvedValue(memberView());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Mill fire' })).toBeInTheDocument();
    await waitFor(() => expect(mockRelatedArticles).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Articles' })).not.toBeInTheDocument();
  });
});
