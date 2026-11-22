import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { EventFullView, EventMemberView } from '../types';

const mockGetEvent = vi.fn();
const mockPublish = vi.fn();
const mockListRevisions = vi.fn();

vi.mock('../services/api', () => ({
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
});
