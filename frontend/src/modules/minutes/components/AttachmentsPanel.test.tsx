import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockUpload = vi.fn();
const mockDownload = vi.fn();
const mockDelete = vi.fn();
const mockSave = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getAttachments: (...a: unknown[]) => mockList(...a) as unknown,
    uploadAttachment: (...a: unknown[]) => mockUpload(...a) as unknown,
    downloadAttachment: (...a: unknown[]) => mockDownload(...a) as unknown,
    deleteAttachment: (...a: unknown[]) => mockDelete(...a) as unknown,
  },
}));

vi.mock('../../../utils/saveBlob', () => ({
  saveBlob: (...a: unknown[]) => mockSave(...a) as unknown,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => toastSuccess(...a) as unknown,
    error: (...a: unknown[]) => toastError(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { AttachmentsPanel } from './AttachmentsPanel';
import { renderWithRouter } from '../../../test/utils';
import type { MinutesAttachment } from '../types/minutes';

const report: MinutesAttachment = {
  id: 'a1',
  minutes_id: 'm1',
  title: 'Treasurer report',
  category: 'report',
  original_name: 'treasurer.pdf',
  mime_type: 'application/pdf',
  file_size: 2048,
  sha256: 'ab'.repeat(32),
  uploaded_by_name: 'Sam Secretary',
  uploaded_at: '2026-10-02T12:00:00Z',
};

describe('AttachmentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockReset();
    mockUpload.mockReset();
    mockDownload.mockReset();
    mockDelete.mockReset();
    mockList.mockResolvedValue([report]);
  });

  it('lists files with size, uploader and a hash prefix', async () => {
    renderWithRouter(<AttachmentsPanel minutesId="m1" status="approved" canManage={false} />);

    expect(await screen.findByText('Treasurer report')).toBeInTheDocument();
    expect(screen.getByText(/treasurer\.pdf · 2\.0 KB · .* by Sam Secretary/)).toBeInTheDocument();
    expect(screen.getByText(/SHA-256 abababababababab…/)).toBeInTheDocument();
  });

  it('shows a reader nothing when there are no files', async () => {
    mockList.mockResolvedValue([]);
    const { container } = renderWithRouter(<AttachmentsPanel minutesId="m1" status="approved" canManage={false} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('downloads under the original file name', async () => {
    const blob = new Blob(['pdf']);
    mockDownload.mockResolvedValue(blob);
    const user = userEvent.setup();
    renderWithRouter(<AttachmentsPanel minutesId="m1" status="approved" canManage={false} />);

    await user.click(await screen.findByRole('button', { name: 'Download Treasurer report' }));

    expect(mockDownload).toHaveBeenCalledWith('m1', 'a1');
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(blob, 'treasurer.pdf'));
  });

  describe('on draft minutes', () => {
    it('offers every kind except the signed copy, and lets a manager delete', async () => {
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="draft" canManage />);

      const kind = await screen.findByLabelText('Kind of file');
      const offered = within(kind)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value);
      expect(offered).toEqual(['report', 'agenda', 'handout', 'correspondence', 'other']);
      expect(screen.getByRole('button', { name: 'Delete Treasurer report' })).toBeInTheDocument();
    });

    it('uploads with a title defaulted from the file name', async () => {
      mockUpload.mockResolvedValue(report);
      const user = userEvent.setup();
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="draft" canManage />);

      const file = new File(['%PDF'], 'Hose quote.pdf', { type: 'application/pdf' });
      await user.upload(await screen.findByLabelText('File'), file);
      expect(screen.getByLabelText('Title')).toHaveValue('Hose quote');
      await user.selectOptions(screen.getByLabelText('Kind of file'), 'handout');
      await user.click(screen.getByRole('button', { name: 'Attach file' }));

      expect(mockUpload).toHaveBeenCalledWith('m1', file, { title: 'Hose quote', category: 'handout' });
      expect(toastSuccess).toHaveBeenCalledWith('File attached');
    });

    it('will not submit without a file', async () => {
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="draft" canManage />);
      expect(await screen.findByRole('button', { name: 'Attach file' })).toBeDisabled();
    });

    it('refuses a file over the size limit without sending it', async () => {
      const user = userEvent.setup({ applyAccept: false });
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="draft" canManage />);

      const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
      Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
      await user.upload(await screen.findByLabelText('File'), big);

      expect(toastError).toHaveBeenCalledWith('That file is larger than 25.0 MB.');
      expect(screen.getByRole('button', { name: 'Attach file' })).toBeDisabled();
    });

    it('deletes only after confirmation', async () => {
      mockDelete.mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="draft" canManage />);

      await user.click(await screen.findByRole('button', { name: 'Delete Treasurer report' }));
      await user.click(await screen.findByRole('button', { name: 'Keep it' }));
      expect(mockDelete).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Delete Treasurer report' }));
      await user.click(await screen.findByRole('button', { name: 'Delete file' }));
      await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('m1', 'a1'));
    });

    it('lets a plain reader see the list but not change it', async () => {
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="draft" canManage={false} />);

      await screen.findByText('Treasurer report');
      expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });
  });

  describe('on approved minutes', () => {
    it('accepts only the signed copy and offers no deletion', async () => {
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="approved" canManage />);

      const kind = await screen.findByLabelText('Kind of file');
      expect(
        within(kind)
          .getAllByRole('option')
          .map((o) => (o as HTMLOptionElement).value)
      ).toEqual(['signed_copy']);
      expect(kind).toBeDisabled();
      expect(screen.getByText(/locked/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    });

    it('files the signed copy', async () => {
      mockUpload.mockResolvedValue({ ...report, id: 'a2', category: 'signed_copy' });
      const user = userEvent.setup();
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="approved" canManage />);

      const file = new File(['%PDF'], 'signed.pdf', { type: 'application/pdf' });
      await user.upload(await screen.findByLabelText('File'), file);
      await user.click(screen.getByRole('button', { name: 'File signed copy' }));

      expect(mockUpload).toHaveBeenCalledWith('m1', file, { title: 'signed', category: 'signed_copy' });
    });
  });

  describe('while awaiting approval', () => {
    it('takes no uploads', async () => {
      renderWithRouter(<AttachmentsPanel minutesId="m1" status="submitted" canManage />);
      await screen.findByText('Treasurer report');
      expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
    });
  });
});
