import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const saveFile = vi.fn();
vi.mock('@/utils/fileDownload', () => ({
  saveFile: (...args: unknown[]) => saveFile(...args) as unknown,
}));

import { ReceiptControl } from './ReceiptControl';

describe('ReceiptControl', () => {
  const onUpload = vi.fn();
  const onDownload = vi.fn();

  beforeEach(() => {
    onUpload.mockReset();
    onUpload.mockResolvedValue(undefined);
    onDownload.mockReset();
    onDownload.mockResolvedValue({ blob: new Blob(['x']), filename: 'PR-1_Receipt.pdf' });
    saveFile.mockReset();
  });

  it('downloads an uploaded receipt under the server name', async () => {
    const user = userEvent.setup();
    render(
      <ReceiptControl
        subject="Hotel"
        receiptFileUrl="/api/v1/finance/x"
        canAttach={false}
        onUpload={onUpload}
        onDownload={onDownload}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Download receipt for Hotel' }));
    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith({ blob: expect.any(Blob) as Blob, filename: 'PR-1_Receipt.pdf' })
    );
    expect(screen.queryByLabelText(/Attach receipt/)).not.toBeInTheDocument();
  });

  it('attaches a receipt from the keyboard-reachable file input', async () => {
    const user = userEvent.setup();
    render(<ReceiptControl subject="Hotel" canAttach onUpload={onUpload} onDownload={onDownload} />);
    const file = new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Attach receipt for Hotel'), file);
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
  });

  it('offers to replace, not attach, once a receipt is on file', () => {
    render(
      <ReceiptControl
        subject="Hotel"
        receiptFileUrl="/api/v1/finance/x"
        canAttach
        onUpload={onUpload}
        onDownload={onDownload}
      />
    );
    expect(screen.getByLabelText('Replace receipt for Hotel')).toBeInTheDocument();
  });

  it('shows a legacy link only as the server passed it on', () => {
    render(
      <ReceiptControl
        subject="Hotel"
        receiptUrl="https://example.com/r.pdf"
        canAttach={false}
        onUpload={onUpload}
        onDownload={onDownload}
      />
    );
    expect(screen.getByRole('link', { name: 'Open receipt link for Hotel' })).toHaveAttribute(
      'href',
      'https://example.com/r.pdf'
    );
  });
});
