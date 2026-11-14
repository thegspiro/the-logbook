import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { MediaFullView, MediaMemberView } from '../types';

const mockGetMedia = vi.fn();
const mockPublish = vi.fn();
const mockRevisions = vi.fn();

vi.mock('../services/api', () => ({
  historyMediaService: {
    getMedia: (...args: unknown[]) => mockGetMedia(...args) as unknown,
    publish: (...args: unknown[]) => mockPublish(...args) as unknown,
    listRevisions: (...args: unknown[]) => mockRevisions(...args) as unknown,
  },
  historyService: { submitForClearance: vi.fn(), listRevisions: vi.fn() },
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryMediaItemPage from './HistoryMediaItemPage';

const catalogue = {
  id: 'm1',
  kind: 'photo' as const,
  title: 'Engine 3 at the parade',
  description: 'The new pumper',
  taken_date: '1962-07-01',
  taken_date_precision: 'month' as const,
  taken_date_circa: false,
  place: 'Main Street',
  creator: null,
  source_id: null,
  source_name: 'Smith family',
  rights_note: null,
  accession_number: null,
  original_location: null,
  width: 1600,
  height: 1200,
  duration_seconds: null,
  has_thumbnail: true,
  mime_type: 'image/webp',
  publication_level: 'draft' as const,
};

const memberView = (): MediaMemberView => ({
  ...catalogue,
  publication_level: 'members',
  view: 'member',
  tags: [{ member_id: 'p1', display_name: 'John Smith' }],
});

const fullView = (overrides: Partial<MediaFullView> = {}): MediaFullView => ({
  ...catalogue,
  view: 'full',
  research_notes: 'From the attic',
  original_filename: 'IMG_0042.JPG',
  original_mime_type: 'image/jpeg',
  original_size_bytes: 2_400_000,
  original_sha256: 'abc',
  batch_id: null,
  tags: [
    { member_id: 'p1', display_name: 'John Smith', consent: 'granted' },
    { member_id: 'p2', display_name: 'Dora Jones', consent: 'declined' },
  ],
  published_at: null,
  revision_number: 1,
  public_revision_number: null,
  public_changes_pending: false,
  clearance_required: true,
  cleared_for_public: false,
  clearance: null,
  can_edit: true,
  can_publish: true,
  created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T00:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/media/m1']}>
        <Routes>
          <Route path="/history/media/:mediaId" element={<HistoryMediaItemPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryMediaItemPage', () => {
  beforeEach(() => {
    mockGetMedia.mockReset();
    mockPublish.mockReset();
    mockRevisions.mockReset();
    mockRevisions.mockResolvedValue([]);
  });

  it('shows a member the stripped copy and nothing of the Historian’s', async () => {
    mockGetMedia.mockResolvedValue(memberView());
    renderPage();
    const image = await screen.findByRole('img', { name: 'Engine 3 at the parade' });
    expect(image).toHaveAttribute('src', '/api/v1/history/media/m1/view');
    expect(screen.getByRole('link', { name: 'John Smith' })).toHaveAttribute('href', '/history/people/p1');
    expect(screen.queryByText('Historian only')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Original/ })).not.toBeInTheDocument();
  });

  it('shows the Historian each tagged person’s consent answer', async () => {
    mockGetMedia.mockResolvedValue(fullView());
    renderPage();
    expect(await screen.findByText('Historian only')).toBeInTheDocument();
    expect(screen.getByText('Declined photo use')).toBeInTheDocument();
    expect(screen.getByText('Photo use granted')).toBeInTheDocument();
  });

  it('warns before publishing someone who declined, and publishes anyway when told to', async () => {
    mockGetMedia.mockResolvedValue(fullView());
    mockPublish.mockResolvedValue({ item: fullView(), consent_warnings: [] });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to members' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Dora Jones (declined photo use)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(mockPublish).toHaveBeenCalledWith('m1', 'members');
  });

  it('holds public publishing until the server says the item is cleared', async () => {
    mockGetMedia.mockResolvedValue(fullView());
    renderPage();
    expect(await screen.findByRole('button', { name: 'Publish to the public' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit for public clearance' })).toBeInTheDocument();
  });

  it('plays the stripped copy of a recording and shows its length', async () => {
    mockGetMedia.mockResolvedValue(
      fullView({ kind: 'audio', mime_type: 'audio/mpeg', duration_seconds: 754, tags: [] })
    );
    renderPage();
    expect(await screen.findByLabelText('Engine 3 at the parade')).toHaveAttribute(
      'src',
      '/api/v1/history/media/m1/view'
    );
    expect(screen.getByText('12:34')).toBeInTheDocument();
  });

  it('publishes a recording with no one tagged without asking', async () => {
    mockGetMedia.mockResolvedValue(fullView({ kind: 'video', mime_type: 'video/mp4', tags: [] }));
    mockPublish.mockResolvedValue({ item: fullView(), consent_warnings: [] });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Publish to members' }));
    expect(mockPublish).toHaveBeenCalledWith('m1', 'members');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
