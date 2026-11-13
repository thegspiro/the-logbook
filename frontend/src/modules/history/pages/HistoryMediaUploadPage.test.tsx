import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockUpload = vi.fn();
const mockListSources = vi.fn();

vi.mock('../services/api', () => ({
  historyMediaService: {
    uploadMedia: (...args: unknown[]) => mockUpload(...args) as unknown,
    listSources: (...args: unknown[]) => mockListSources(...args) as unknown,
  },
  historyService: { listPeople: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

import HistoryMediaUploadPage from './HistoryMediaUploadPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryMediaUploadPage />
    </MemoryRouter>
  );

describe('HistoryMediaUploadPage', () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockListSources.mockReset();
    mockListSources.mockResolvedValue([]);
  });

  it('sends each file on its own, carries on past a refusal, and skips what cannot be sent', async () => {
    mockUpload
      .mockRejectedValueOnce(Object.assign(new Error('nope'), { response: { data: { detail: 'Unreadable image' } } }))
      .mockResolvedValueOnce({ id: 'm2' });
    // The browser's picker hides a PDF; a drag or "All files" still offers one.
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    const input = screen.getByLabelText('Choose files');
    await user.upload(input, [
      new File(['a'], 'bad.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'good.png', { type: 'image/png' }),
      new File(['c'], 'letter.pdf', { type: 'application/pdf' }),
    ]);
    const queue = screen.getByRole('list', { name: 'Upload queue' });
    expect(within(queue).getByText('Not an accepted type')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Place'), 'Main Street');
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 files' }));

    expect(await within(queue).findByRole('link', { name: 'Uploaded' })).toHaveAttribute('href', '/history/media/m2');
    expect(within(queue).getByText('Unreadable image')).toBeInTheDocument();
    expect(mockUpload).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mockUpload.mock.calls;
    // The same batch and the same catalogue for every file.
    expect(firstCall?.[1]).toMatchObject({ place: 'Main Street', tag_member_ids: [] });
    expect(firstCall?.[2]).toBe(secondCall?.[2]);
  });

  it('warns that audio and video are shown as uploaded', async () => {
    renderPage();
    await userEvent.upload(screen.getByLabelText('Choose files'), new File(['a'], 'interview.mp3'));
    expect(screen.getByText(/shown to members exactly as uploaded/)).toBeInTheDocument();
  });

  it('takes at most 25 files', async () => {
    renderPage();
    const files = Array.from({ length: 27 }, (_, i) => new File(['a'], `p${i}.jpg`, { type: 'image/jpeg' }));
    await userEvent.upload(screen.getByLabelText('Choose files'), files);
    expect(screen.getByRole('alert')).toHaveTextContent('Only the first 25 files were added');
    expect(screen.getByRole('button', { name: 'Upload 25 files' })).toBeEnabled();
  });
});
