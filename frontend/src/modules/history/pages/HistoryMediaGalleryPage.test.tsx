import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockListMedia = vi.fn();
const mockListAlbums = vi.fn();
const mockCheckPermission = vi.fn();

vi.mock('../services/api', () => ({
  historyMediaService: {
    listMedia: (...args: unknown[]) => mockListMedia(...args) as unknown,
    listAlbums: (...args: unknown[]) => mockListAlbums(...args) as unknown,
  },
  mediaFileUrl: (id: string, which: string) => `/api/v1/history/media/${id}/${which}`,
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector?: (state: { checkPermission: (p: string) => boolean }) => unknown) => {
    const state = { checkPermission: (p: string) => mockCheckPermission(p) as boolean };
    return selector ? selector(state) : state;
  },
}));

import HistoryMediaGalleryPage from './HistoryMediaGalleryPage';

const summary = {
  id: 'm1',
  kind: 'photo' as const,
  title: 'Engine 3 at the parade',
  taken_date: '1962-07-01',
  taken_date_precision: 'month' as const,
  taken_date_circa: false,
  duration_seconds: null,
  has_thumbnail: true,
  publication_level: 'members' as const,
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryMediaGalleryPage />
    </MemoryRouter>
  );

describe('HistoryMediaGalleryPage', () => {
  beforeEach(() => {
    mockListMedia.mockReset();
    mockListAlbums.mockReset();
    mockCheckPermission.mockReset();
    mockListMedia.mockResolvedValue({ items: [summary], total: 1 });
    mockListAlbums.mockResolvedValue([]);
    mockCheckPermission.mockReturnValue(false);
  });

  it('shows a member the published items, with no upload and no publication filter', async () => {
    renderPage();
    expect(await screen.findByText('Engine 3 at the parade')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Upload' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Publication')).not.toBeInTheDocument();
  });

  it('sends the filters to the server and starts again from the first page', async () => {
    renderPage();
    await screen.findByText('Engine 3 at the parade');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'audio');
    await userEvent.selectOptions(screen.getByLabelText('Decade'), '1960');
    await waitFor(() =>
      expect(mockListMedia).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'audio', decade: 1960, offset: 0 })
      )
    );
  });

  it('gives the Historian the upload link and the publication filter', async () => {
    mockCheckPermission.mockImplementation((p: string) => p === 'history.manage');
    renderPage();
    expect(await screen.findByRole('link', { name: 'Upload' })).toHaveAttribute('href', '/history/media/upload');
    expect(screen.getByLabelText('Publication')).toBeInTheDocument();
  });

  it('says when a filter matches nothing', async () => {
    mockListMedia.mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await userEvent.type(screen.getByLabelText('Search'), 'zeppelin');
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
  });
});
