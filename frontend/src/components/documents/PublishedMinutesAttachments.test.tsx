import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockList = vi.fn();
const mockDownload = vi.fn();

vi.mock('../../services/api', () => ({
  documentsService: {
    getPublishedMinutesAttachments: (...a: unknown[]) => mockList(...a) as unknown,
    downloadPublishedMinutesAttachment: (...a: unknown[]) => mockDownload(...a) as unknown,
  },
}));

import { PublishedMinutesAttachments } from './PublishedMinutesAttachments';

const attachment = {
  id: 'att-1',
  title: 'Treasurer report',
  category: 'report',
  description: null,
  original_name: 'treasurer-oct.pdf',
  mime_type: 'application/pdf',
  file_size: 2048,
  sha256: 'a'.repeat(64),
  uploaded_at: '2026-10-01T00:00:00Z',
};

describe('PublishedMinutesAttachments', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDownload.mockReset();
    mockList.mockResolvedValue([attachment]);
    mockDownload.mockResolvedValue(new Blob(['%PDF']));
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    // jsdom cannot follow the download link the component clicks.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('asks for nothing until it is opened', () => {
    render(<PublishedMinutesAttachments documentId="doc-1" documentName="October minutes" />);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('lists the files published with the minutes', async () => {
    render(<PublishedMinutesAttachments documentId="doc-1" documentName="October minutes" />);
    await userEvent.click(screen.getByRole('button', { name: /attachments/i }));

    expect(await screen.findByText('Treasurer report')).toBeInTheDocument();
    expect(screen.getByText(/treasurer-oct\.pdf/)).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith('doc-1');
  });

  it('downloads a file through the published document', async () => {
    render(<PublishedMinutesAttachments documentId="doc-1" documentName="October minutes" />);
    await userEvent.click(screen.getByRole('button', { name: /attachments/i }));
    await userEvent.click(await screen.findByRole('button', { name: /download treasurer report/i }));

    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith('doc-1', 'att-1'));
  });

  it('says so when nothing was published with the minutes', async () => {
    mockList.mockResolvedValue([]);
    render(<PublishedMinutesAttachments documentId="doc-1" documentName="October minutes" />);
    await userEvent.click(screen.getByRole('button', { name: /attachments/i }));

    expect(await screen.findByText(/no files were published/i)).toBeInTheDocument();
  });

  it('reports a failed load rather than an empty list', async () => {
    mockList.mockRejectedValue(new Error('offline'));
    render(<PublishedMinutesAttachments documentId="doc-1" documentName="October minutes" />);
    await userEvent.click(screen.getByRole('button', { name: /attachments/i }));

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/no files were published/i)).not.toBeInTheDocument();
  });
});
