import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const mockUpload = vi.fn();

vi.mock('../services/api', () => ({
  historyDocumentService: {
    uploadDocument: (...args: unknown[]) => mockUpload(...args) as unknown,
    listTypes: vi
      .fn()
      .mockResolvedValue([{ id: 't-letter', name: 'Letter', sort_order: 0, is_retired: false, usage_count: 0 }]),
  },
  historyMediaService: { listSources: vi.fn().mockResolvedValue([]) },
  historyService: { listPeople: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

import HistoryDocumentUploadPage from './HistoryDocumentUploadPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryDocumentUploadPage />
    </MemoryRouter>
  );

describe('HistoryDocumentUploadPage', () => {
  beforeEach(() => {
    mockUpload.mockReset();
  });

  it('sends each file on its own with the document fields, and skips a Word file', async () => {
    mockUpload.mockResolvedValue({ id: 'd1' });
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    await user.upload(screen.getByLabelText('Choose files'), [
      new File(['a'], 'letter.pdf', { type: 'application/pdf' }),
      new File(['b'], 'draft.docx'),
    ]);
    const queue = screen.getByRole('list', { name: 'Upload queue' });
    expect(within(queue).getByText('Convert Word files to PDF first')).toBeInTheDocument();

    await user.selectOptions(await screen.findByLabelText('Type'), 't-letter');
    await user.type(screen.getByLabelText('Author or sender'), 'Mayor Jones');
    await user.type(screen.getByLabelText('Transcription'), 'Dear Chief');
    await user.click(screen.getByRole('button', { name: 'Upload 1 file' }));

    expect(await within(queue).findByRole('link', { name: 'Uploaded' })).toHaveAttribute(
      'href',
      '/history/documents/d1'
    );
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0]?.[1]).toMatchObject({
      document_type_id: 't-letter',
      author: 'Mayor Jones',
      transcription: 'Dear Chief',
      tag_member_ids: [],
    });
  });

  it('marks a refused upload and carries on with the next file', async () => {
    mockUpload
      .mockRejectedValueOnce(
        Object.assign(new Error('nope'), { response: { data: { detail: 'This PDF is password-protected.' } } })
      )
      .mockResolvedValueOnce({ id: 'd2' });
    const user = userEvent.setup();
    renderPage();
    await user.upload(screen.getByLabelText('Choose files'), [
      new File(['a'], 'locked.pdf', { type: 'application/pdf' }),
      new File(['b'], 'open.pdf', { type: 'application/pdf' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Upload 2 files' }));
    const queue = screen.getByRole('list', { name: 'Upload queue' });
    expect(await within(queue).findByRole('link', { name: 'Uploaded' })).toHaveAttribute(
      'href',
      '/history/documents/d2'
    );
    expect(within(queue).getByText('This PDF is password-protected.')).toBeInTheDocument();
  });
});
