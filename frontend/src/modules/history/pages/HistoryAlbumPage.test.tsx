import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { AlbumDetail } from '../types';

const mockGetAlbum = vi.fn();
const mockSetEntries = vi.fn();

vi.mock('../services/api', () => ({
  historyMediaService: {
    getAlbum: (...args: unknown[]) => mockGetAlbum(...args) as unknown,
    setAlbumEntries: (...args: unknown[]) => mockSetEntries(...args) as unknown,
    listMedia: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
  historyDocumentService: { listDocuments: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
  documentFileUrl: (id: string, which: string) => `/api/v1/history/documents/${id}/${which}`,
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import HistoryAlbumPage from './HistoryAlbumPage';

const photo = {
  id: 'm1',
  kind: 'photo' as const,
  title: 'Engine 3 at the parade',
  taken_date: null,
  taken_date_precision: 'year' as const,
  taken_date_circa: false,
  duration_seconds: null,
  has_thumbnail: false,
  publication_level: 'members' as const,
};
const letter = {
  id: 'd1',
  kind: 'pdf' as const,
  title: 'The parade programme',
  taken_date: null,
  taken_date_precision: 'year' as const,
  taken_date_circa: false,
  document_type_name: 'Programme',
  page_count: 4,
  has_thumbnail: false,
  publication_level: 'members' as const,
};

const album = (): AlbumDetail => ({
  id: 'a1',
  name: 'Parade 1962',
  description: null,
  level: 'members',
  cover_media_id: null,
  item_count: 2,
  items: [photo],
  entries: [
    { kind: 'document', media: null, document: letter },
    { kind: 'media', media: photo, document: null },
  ],
  can_edit: true,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/albums/a1']}>
        <Routes>
          <Route path="/history/albums/:albumId" element={<HistoryAlbumPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryAlbumPage', () => {
  beforeEach(() => {
    mockGetAlbum.mockReset();
    mockSetEntries.mockReset();
    mockGetAlbum.mockResolvedValue(album());
    mockSetEntries.mockResolvedValue(album());
  });

  it('shows photos and documents in the album’s one order', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: /parade/i });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/history/documents/d1', '/history/media/m1']);
  });

  it('removing a photo keeps the document', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Engine 3 at the parade from the album' }));
    expect(mockSetEntries).toHaveBeenCalledWith('a1', [{ kind: 'document', id: 'd1' }]);
  });

  it('moves a document after a photo', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Move The parade programme later' }));
    expect(mockSetEntries).toHaveBeenCalledWith('a1', [
      { kind: 'media', id: 'm1' },
      { kind: 'document', id: 'd1' },
    ]);
  });
});
