/**
 * WaiverAttachmentList — the documents filed with one waiver request.
 *
 * For the request's page, seen by its member and by the people who decide it
 * (the only callers the backend answers). Each document downloads under its
 * neutral name (`waiver-attachment-1.pdf`) through the authenticated client.
 * PDF and image documents can also be viewed: an image in a dialog in the
 * page, a PDF in a new tab under the browser's own viewer. Both come from the
 * same authorised, audited download as a fetched copy behind a local
 * `blob:` URL, never a public link. A PDF is not shown inside the page: the
 * app's Content-Security-Policy allows `blob:` images but not `blob:`
 * frames or objects. HEIC has no view: most browsers cannot render it.
 *
 * When `canAttach` is set (the member, while the request is pending, under a
 * policy that takes documents) it also offers to file more. With `onRemove`
 * (the member, while pending: the server's `can_remove_attachment`) each
 * document gets a remove button; the page confirms and calls the API.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Eye, FileText, Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatDateTime, formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import {
  WaiverAttachmentMode,
  waiverAttachmentService,
  type WaiverAttachment,
} from '../../services/waiverAttachmentService';
import { WaiverAttachmentField, type WaiverAttachmentSelection } from './WaiverAttachmentField';
import { Modal } from '../Modal';

interface WaiverAttachmentListProps {
  requestId: string;
  attachments: readonly WaiverAttachment[];
  /** From the request response's `can_attach`. */
  canAttach?: boolean;
  /** Called after more documents are filed; the page re-fetches the request. */
  onAttached?: () => void;
  /** Offered only when the server allows removal; the page confirms first. */
  onRemove?: (attachment: WaiverAttachment) => void;
  /** The document being removed, whose button is disabled meanwhile. */
  removingId?: string | null;
  /** How many documents retention removed, and when (the request's own record). */
  removedCount?: number | null | undefined;
  removedAt?: string | null | undefined;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

const EMPTY_SELECTION: WaiverAttachmentSelection = { files: [], valid: false };

/** The types a browser can show: everything this area accepts but HEIC. */
const VIEWABLE_IMAGES = new Set(['image/jpeg', 'image/png']);
const isPdf = (attachment: WaiverAttachment) => attachment.mime_type === 'application/pdf';
const isViewable = (attachment: WaiverAttachment) => isPdf(attachment) || VIEWABLE_IMAGES.has(attachment.mime_type);

/** How long a PDF's object URL outlives handing it to the new tab, so the
 *  browser's viewer has loaded it before the URL is let go. */
const PDF_URL_LIFETIME_MS = 60_000;

export const WaiverAttachmentList: React.FC<WaiverAttachmentListProps> = ({
  requestId,
  attachments,
  canAttach = false,
  onAttached,
  onRemove,
  removingId = null,
  removedCount = null,
  removedAt = null,
}) => {
  const tz = useTimezone();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [selection, setSelection] = useState<WaiverAttachmentSelection>(EMPTY_SELECTION);
  const [uploading, setUploading] = useState(false);
  // Remounts the picker after an upload so it starts empty.
  const [pickerKey, setPickerKey] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [shown, setShown] = useState<{ name: string; url: string } | null>(null);

  // The dialog's object URL is let go when the dialog closes or the list
  // unmounts, so a medical photo does not stay addressable in the tab.
  useEffect(
    () => () => {
      if (shown) URL.revokeObjectURL(shown.url);
    },
    [shown]
  );

  const view = async (attachment: WaiverAttachment) => {
    // Opened inside the click, before the fetch: a tab opened after an
    // await is a pop-up the browser may block.
    const tab = isPdf(attachment) ? window.open('', '_blank') : null;
    setViewing(attachment.id);
    try {
      const blob = await waiverAttachmentService.fetchAttachment(requestId, attachment);
      const url = URL.createObjectURL(blob);
      if (isPdf(attachment)) {
        if (!tab) {
          URL.revokeObjectURL(url);
          toast.error('Allow pop-ups for this site to view the document, or download it.');
          return;
        }
        tab.opener = null;
        tab.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), PDF_URL_LIFETIME_MS);
      } else {
        setShown({ name: attachment.filename, url });
      }
    } catch (err: unknown) {
      tab?.close();
      toast.error(getErrorMessage(err, 'Could not open the document.'));
    } finally {
      setViewing(null);
    }
  };

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
      {removedCount && removedCount > 0 && removedAt ? (
        <p className="text-theme-text-muted mb-2 text-sm">
          {removedCount} {removedCount === 1 ? 'document' : 'documents'} removed under retention on{' '}
          {formatDate(removedAt, tz)}.
        </p>
      ) : null}
      {attachments.length === 0 ? (
        !removedCount && <p className="text-theme-text-muted text-sm">No documents are on file for this request.</p>
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
                {isViewable(attachment) && (
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => void view(attachment)}
                    disabled={viewing === attachment.id}
                    aria-label={`View ${attachment.filename}`}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => void download(attachment)}
                  disabled={downloading === attachment.id}
                  aria-label={`Download ${attachment.filename}`}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                {onRemove && (
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => onRemove(attachment)}
                    disabled={removingId === attachment.id}
                    aria-label={`Remove ${attachment.filename}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
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
      {shown && (
        <Modal isOpen onClose={() => setShown(null)} title={shown.name} size="xl">
          <img src={shown.url} alt={shown.name} className="mx-auto max-h-[70vh] max-w-full object-contain" />
        </Modal>
      )}
    </section>
  );
};

export default WaiverAttachmentList;
