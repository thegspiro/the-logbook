/**
 * The receipt on a purchase request or an expense line: open it, and attach
 * or replace it when the backend would allow that.
 *
 * An uploaded receipt is a document under Finance > Receipts, served through
 * the finance endpoint behind the record's own access rule. A typed link from
 * before uploads existed is shown only as the server passes it on (HTTP(S)
 * only). Replacing a receipt keeps the earlier file on record server-side.
 */

import React, { useId, useState } from 'react';
import { Download, ExternalLink, Paperclip } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/utils/errorHandling';
import { saveFile, type DownloadedFile } from '@/utils/fileDownload';

const RECEIPT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/gif,image/webp';

interface ReceiptControlProps {
  /** What the receipt belongs to, for accessible names ("Hotel"). */
  subject: string;
  receiptFileUrl?: string | null | undefined;
  receiptUrl?: string | null | undefined;
  canAttach: boolean;
  onUpload: (file: File) => Promise<unknown>;
  onDownload: () => Promise<DownloadedFile>;
}

export const ReceiptControl: React.FC<ReceiptControlProps> = ({
  subject,
  receiptFileUrl,
  receiptUrl,
  canAttach,
  onUpload,
  onDownload,
}) => {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const hasUpload = Boolean(receiptFileUrl);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await onUpload(file);
      toast.success('Receipt attached');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to attach receipt'));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    try {
      saveFile(await onDownload());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to download receipt'));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasUpload ? (
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 inline-flex items-center gap-1 text-sm"
          aria-label={`Download receipt for ${subject}`}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Receipt
        </button>
      ) : (
        receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 inline-flex items-center gap-1 text-sm"
            aria-label={`Open receipt link for ${subject}`}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Receipt
          </a>
        )
      )}
      {canAttach && (
        <label
          htmlFor={inputId}
          className={`text-theme-text-secondary hover:text-theme-text-primary focus-within:ring-theme-focus-ring touch:min-h-11 inline-flex cursor-pointer items-center gap-1 rounded text-sm focus-within:ring-2 ${
            uploading ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          <input
            id={inputId}
            type="file"
            accept={RECEIPT_ACCEPT}
            className="sr-only"
            onChange={(e) => void handleFile(e)}
            aria-label={`${hasUpload ? 'Replace' : 'Attach'} receipt for ${subject}`}
            disabled={uploading}
          />
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          <span aria-hidden="true">{uploading ? 'Uploading…' : hasUpload ? 'Replace' : 'Attach receipt'}</span>
        </label>
      )}
    </div>
  );
};

export default ReceiptControl;
