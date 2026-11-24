import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockDownload = vi.fn();
const mockAdd = vi.fn();
const mockFetch = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../services/waiverAttachmentService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/waiverAttachmentService')>();
  return {
    ...actual,
    waiverAttachmentService: {
      downloadAttachment: (...args: unknown[]) => mockDownload(...args) as unknown,
      addAttachments: (...args: unknown[]) => mockAdd(...args) as unknown,
      fetchAttachment: (...args: unknown[]) => mockFetch(...args) as unknown,
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

  // Owner decision 2026-11-23: view a document in the page, through the same
  // authorised download, never a public URL.
  describe('viewing a document', () => {
    const image: WaiverAttachment = {
      ...attachment,
      id: 'a2',
      filename: 'waiver-attachment-2.png',
      mime_type: 'image/png',
    };
    const heic: WaiverAttachment = {
      ...attachment,
      id: 'a3',
      filename: 'waiver-attachment-3.heic',
      mime_type: 'image/heic',
    };
    const createObjectURL = vi.fn(() => 'blob:local/doc');
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;

    beforeEach(() => {
      mockFetch.mockReset();
      mockFetch.mockResolvedValue(new Blob(['x']));
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    });

    afterEach(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      vi.restoreAllMocks();
    });

    it('shows an image in a dialog and lets the object URL go on close', async () => {
      render(<WaiverAttachmentList requestId="r1" attachments={[image]} />);
      await user.click(screen.getByRole('button', { name: 'View waiver-attachment-2.png' }));

      expect(mockFetch).toHaveBeenCalledWith('r1', image);
      const dialog = await screen.findByRole('dialog', { name: 'waiver-attachment-2.png' });
      expect(within(dialog).getByRole('img', { name: 'waiver-attachment-2.png' })).toHaveAttribute(
        'src',
        'blob:local/doc'
      );

      await user.click(within(dialog).getByRole('button', { name: /close/i }));
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:local/doc');
    });

    it('opens a PDF in a new tab from the fetched copy', async () => {
      const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      render(<WaiverAttachmentList requestId="r1" attachments={[attachment]} />);

      await user.click(screen.getByRole('button', { name: 'View waiver-attachment-1.pdf' }));

      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(mockFetch).toHaveBeenCalledWith('r1', attachment);
      expect(tab.location.href).toBe('blob:local/doc');
      expect(tab.opener).toBeNull();
    });

    it('offers no view for HEIC, which browsers cannot show', () => {
      render(<WaiverAttachmentList requestId="r1" attachments={[heic]} />);
      expect(screen.getByRole('button', { name: 'Download waiver-attachment-3.heic' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'View waiver-attachment-3.heic' })).not.toBeInTheDocument();
    });

    it('reports a failed fetch and closes the blank tab', async () => {
      const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      mockFetch.mockRejectedValue(new Error('Request not found'));
      render(<WaiverAttachmentList requestId="r1" attachments={[attachment]} />);

      await user.click(screen.getByRole('button', { name: 'View waiver-attachment-1.pdf' }));

      expect(mockToastError).toHaveBeenCalledWith('Request not found');
      expect(tab.close).toHaveBeenCalled();
    });
  });
});
