/**
 * WaiverAttachmentList — the documents filed with one waiver request.
 *
 * For the request's page, seen by its member and by the people who decide it
 * (the only callers the backend answers). Each document downloads under its
 * neutral name (`waiver-attachment-1.pdf`) through the authenticated client.
 * When `canAttach` is set (the member, while the request is pending, under a
 * policy that takes documents) it also offers to file more.
 */

import React, { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime, formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  WaiverAttachmentMode,
  waiverAttachmentService,
  type WaiverAttachment,
} from '../../services/waiverAttachmentService';
import { WaiverAttachmentField, type WaiverAttachmentSelection } from './WaiverAttachmentField';

interface WaiverAttachmentListProps {
  requestId: string;
  attachments: readonly WaiverAttachment[];
  /** From the request response's `can_attach`. */
  canAttach?: boolean;
  /** Called after more documents are filed; the page re-fetches the request. */
  onAttached?: () => void;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

const EMPTY_SELECTION: WaiverAttachmentSelection = { files: [], valid: false };

export const WaiverAttachmentList: React.FC<WaiverAttachmentListProps> = ({
  requestId,
  attachments,
  canAttach = false,
  onAttached,
}) => {
  const tz = useTimezone();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [selection, setSelection] = useState<WaiverAttachmentSelection>(EMPTY_SELECTION);
  const [uploading, setUploading] = useState(false);
  // Remounts the picker after an upload so it starts empty.
  const [pickerKey, setPickerKey] = useState(0);

  const download = async (attachment: WaiverAttachment) => {
    setDownloading(attachment.id);
    try {
      await waiverAttachmentService.downloadAttachment(requestId, attachment);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the document.'));
    } finally {
      setDownloading(null);
    }
  };

  const upload = async () => {
    if (!selection.valid || selection.files.length === 0) return;
    setUploading(true);
    try {
      await waiverAttachmentService.addAttachments(requestId, selection.files);
      toast.success(selection.files.length === 1 ? 'Document filed.' : 'Documents filed.');
      setSelection(EMPTY_SELECTION);
      setPickerKey((k) => k + 1);
      onAttached?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not file the document.'));
    } finally {
      setUploading(false);
    }
  };

  const handleSelection = useCallback((next: WaiverAttachmentSelection) => setSelection(next), []);

  return (
    <section aria-labelledby={`waiver-docs-${requestId}`}>
      <h3 id={`waiver-docs-${requestId}`} className="text-theme-text-primary mb-2 text-sm font-semibold">
        Supporting documents
      </h3>
      {attachments.length === 0 ? (
        <p className="text-theme-text-muted text-sm">No documents are on file for this request.</p>
      ) : (
        <ul className="space-y-2">
          {attachments.map((attachment) => {
            const Icon = attachment.mime_type.startsWith('image/') ? ImageIcon : FileText;
            return (
              <li key={attachment.id} className="bg-theme-surface-secondary flex items-center gap-3 rounded-lg p-2">
                <Icon className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary truncate text-sm">{attachment.filename}</p>
                  <p className="text-theme-text-muted text-xs">
                    {sizeLabel(attachment.file_size)} · filed {formatDateTime(attachment.uploaded_at, tz)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void download(attachment)}
                  disabled={downloading === attachment.id}
                  aria-label={`Download ${attachment.filename}`}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canAttach && (
        <div className="mt-4 space-y-2">
          <WaiverAttachmentField
            key={pickerKey}
            mode={WaiverAttachmentMode.OPTIONAL}
            alreadyFiled={attachments.length}
            onChange={handleSelection}
          />
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => void upload()}
            disabled={uploading || !selection.valid || selection.files.length === 0}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {uploading ? 'Filing…' : 'File documents'}
          </button>
        </div>
      )}
    </section>
  );
};

export default WaiverAttachmentList;
