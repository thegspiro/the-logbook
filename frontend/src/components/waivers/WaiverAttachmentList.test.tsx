import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockDownload = vi.fn();
const mockAdd = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../services/waiverAttachmentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/waiverAttachmentService')>();
  return {
    ...actual,
    waiverAttachmentService: {
      downloadAttachment: (...args: unknown[]) => mockDownload(...args) as unknown,
      addAttachments: (...args: unknown[]) => mockAdd(...args) as unknown,
    },
  };
});
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import { WaiverAttachmentList } from './WaiverAttachmentList';
import type { WaiverAttachment } from '../../services/waiverAttachmentService';

const attachment: WaiverAttachment = {
  id: 'a1',
  ordinal: 1,
  filename: 'waiver-attachment-1.pdf',
  mime_type: 'application/pdf',
  file_size: 2 * 1024 * 1024,
  uploaded_at: '2026-11-10T12:00:00Z',
};

describe('WaiverAttachmentList', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockDownload.mockReset();
    mockDownload.mockResolvedValue(undefined);
    mockAdd.mockReset();
    mockAdd.mockResolvedValue({ id: 'r1' });
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
  });

  it('says when nothing is on file', () => {
    render(<WaiverAttachmentList requestId="r1" attachments={[]} />);
    expect(screen.getByText('No documents are on file for this request.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /file documents/i })).not.toBeInTheDocument();
  });

  it('lists each document under its neutral name and downloads it', async () => {
    render(<WaiverAttachmentList requestId="r1" attachments={[attachment]} />);
    expect(screen.getByText('waiver-attachment-1.pdf')).toBeInTheDocument();
    expect(screen.getByText(/^2 MB · filed/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download waiver-attachment-1.pdf' }));
    expect(mockDownload).toHaveBeenCalledWith('r1', attachment);
  });

  it('reports a failed download', async () => {
    mockDownload.mockRejectedValue(new Error('Request not found'));
    render(<WaiverAttachmentList requestId="r1" attachments={[attachment]} />);
    await user.click(screen.getByRole('button', { name: 'Download waiver-attachment-1.pdf' }));
    expect(mockToastError).toHaveBeenCalledWith('Request not found');
  });

  it('files more documents when the member may', async () => {
    const onAttached = vi.fn();
    render(<WaiverAttachmentList requestId="r1" attachments={[attachment]} canAttach onAttached={onAttached} />);
    const button = screen.getByRole('button', { name: /file documents/i });
    expect(button).toBeDisabled();
    const note = new File(['%PDF'], 'note.pdf', { type: 'application/pdf' });
    fireEvent.drop(screen.getByRole('button', { name: /drop a document here/i }), { dataTransfer: { files: [note] } });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mockAdd).toHaveBeenCalledWith('r1', [note]);
    expect(mockToastSuccess).toHaveBeenCalledWith('Document filed.');
    expect(onAttached).toHaveBeenCalled();
  });

  it('offers a remove button only when the page passes onRemove', async () => {
    const onRemove = vi.fn();
    const { rerender } = render(<WaiverAttachmentList requestId="r1" attachments={[attachment]} />);
    expect(screen.queryByRole('button', { name: 'Remove waiver-attachment-1.pdf' })).not.toBeInTheDocument();

    rerender(<WaiverAttachmentList requestId="r1" attachments={[attachment]} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove waiver-attachment-1.pdf' }));
    expect(onRemove).toHaveBeenCalledWith(attachment);
  });

  // Owner decision 2026-11-23: the request says retention removed documents.
  it('says how many documents retention removed, and on which day', () => {
    render(
      <WaiverAttachmentList
        requestId="r1"
        attachments={[]}
        removedCount={2}
        removedAt="2025-11-09T12:00:00Z"
      />
    );
    expect(screen.getByText('2 documents removed under retention on 11/9/2025.')).toBeInTheDocument();
    expect(screen.queryByText('No documents are on file for this request.')).not.toBeInTheDocument();
  });

  it('uses the singular for one removed document', () => {
    render(
      <WaiverAttachmentList requestId="r1" attachments={[]} removedCount={1} removedAt="2025-11-09T12:00:00Z" />
    );
    expect(screen.getByText('1 document removed under retention on 11/9/2025.')).toBeInTheDocument();
  });
});
