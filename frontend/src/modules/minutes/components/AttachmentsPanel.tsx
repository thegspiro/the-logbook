/**
 * Files filed with a set of minutes: reports, handouts, correspondence and
 * the signed copy.
 *
 * The rules mirror the lock on the minutes themselves. While the minutes are a
 * draft a manager can attach and remove anything except a signed copy. Once
 * they are approved nothing already attached changes; the one thing that can
 * still be filed is the signed copy, which exists only after approval. The
 * server enforces all of this; the screen only offers what will be accepted.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { saveBlob } from '../../../utils/saveBlob';
import { minutesService } from '../services/api';
import type { AttachmentCategory, MinutesAttachment, MinutesStatus } from '../types/minutes';
import { formatBytes } from '../utils/formatBytes';

const CATEGORY_LABELS: Record<AttachmentCategory, string> = {
  signed_copy: 'Signed copy',
  report: 'Report',
  agenda: 'Agenda',
  handout: 'Handout',
  correspondence: 'Correspondence',
  other: 'Other',
};

const DRAFT_CATEGORIES: AttachmentCategory[] = ['report', 'agenda', 'handout', 'correspondence', 'other'];

/** Matches the server's per-file limit. */
const MAX_BYTES = 25 * 1024 * 1024;

interface AttachmentsPanelProps {
  minutesId: string;
  status: MinutesStatus;
  canManage: boolean;
}

export const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({ minutesId, status, canManage }) => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<MinutesAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<AttachmentCategory>('report');
  const [uploading, setUploading] = useState(false);

  const isDraft = status === 'draft' || status === 'rejected';
  const awaitingSignedCopy = status === 'approved';
  const canUpload = canManage && (isDraft || awaitingSignedCopy);
  const categories: AttachmentCategory[] = awaitingSignedCopy ? ['signed_copy'] : DRAFT_CATEGORIES;

  // An approved record can only take a signed copy, so the choice follows the
  // status rather than leaving a stale one selected across a reopen.
  useEffect(() => {
    setCategory(awaitingSignedCopy ? 'signed_copy' : 'report');
  }, [awaitingSignedCopy]);

  const load = useCallback(async () => {
    try {
      setAttachments(await minutesService.getAttachments(minutesId));
    } catch {
      setAttachments([]);
    } finally {
      setLoaded(true);
    }
  }, [minutesId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (picked && picked.size > MAX_BYTES) {
      toast.error(`That file is larger than ${formatBytes(MAX_BYTES)}.`);
      e.target.value = '';
      return;
    }
    setFile(picked);
    if (picked && !title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ''));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setUploading(true);
    try {
      await minutesService.uploadAttachment(minutesId, file, { title: title.trim(), category });
      toast.success('File attached');
      setFile(null);
      setTitle('');
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to attach the file'));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (attachment: MinutesAttachment) => {
    try {
      saveBlob(await minutesService.downloadAttachment(minutesId, attachment.id), attachment.original_name);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to download the file'));
    }
  };

  const handleDelete = async (attachment: MinutesAttachment) => {
    const ok = await confirm({
      title: 'Remove this file?',
      message: `${attachment.title} (${attachment.original_name}) will be deleted from these minutes.`,
      confirmLabel: 'Delete file',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await minutesService.deleteAttachment(minutesId, attachment.id);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove the file'));
    }
  };

  if (!loaded || (attachments.length === 0 && !canUpload)) return null;

  return (
    <section
      className="bg-theme-surface mb-6 rounded-lg p-4 shadow-sm backdrop-blur-xs"
      aria-labelledby="attachments-heading"
    >
      <h2 id="attachments-heading" className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
        <Paperclip className="h-5 w-5" aria-hidden="true" />
        Attachments ({attachments.length})
      </h2>

      {attachments.length === 0 ? (
        <p className="text-theme-text-muted mt-2 text-xs italic">
          No files attached. Reports and handouts the meeting worked from belong here.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="border-theme-surface-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="text-theme-text-primary truncate text-sm font-medium">
                  {attachment.title}
                  <span className="bg-theme-surface-secondary text-theme-text-secondary ml-2 rounded-sm px-2 py-0.5 text-xs">
                    {CATEGORY_LABELS[attachment.category] ?? attachment.category}
                  </span>
                </p>
                <p className="text-theme-text-muted text-xs">
                  {attachment.original_name} &middot; {formatBytes(attachment.file_size)} &middot;{' '}
                  {formatDateTime(attachment.uploaded_at, tz)}
                  {attachment.uploaded_by_name ? ` by ${attachment.uploaded_by_name}` : ''}
                </p>
                <p className="text-theme-text-muted font-mono text-[11px]" title={attachment.sha256}>
                  SHA-256 {attachment.sha256.slice(0, 16)}…
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    void handleDownload(attachment);
                  }}
                  className="btn-icon"
                  aria-label={`Download ${attachment.title}`}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                {canManage && isDraft && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleDelete(attachment);
                    }}
                    className="btn-icon text-red-600 hover:text-red-700"
                    aria-label={`Delete ${attachment.title}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <form
          onSubmit={(e) => {
            void handleUpload(e);
          }}
          className="border-theme-surface-border mt-4 grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2"
        >
          <p className="text-theme-text-secondary text-sm sm:col-span-2">
            {awaitingSignedCopy
              ? 'These minutes are approved and locked. You can file the signed copy; it cannot be removed afterward.'
              : 'PDF, Word, Excel, text or image, up to 25 MB. Files are scanned and stored encrypted.'}
          </p>
          <div>
            <label htmlFor="attachment-file" className="form-label">
              File
            </label>
            <input
              ref={fileInput}
              id="attachment-file"
              type="file"
              onChange={handlePick}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.gif,.webp"
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="attachment-title" className="form-label">
              Title
            </label>
            <input
              id="attachment-title"
              type="text"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="attachment-category" className="form-label">
              Kind of file
            </label>
            <select
              id="attachment-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as AttachmentCategory)}
              disabled={awaitingSignedCopy}
              className="form-input"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={uploading || !file || !title.trim()} className="btn-primary touch:min-h-11">
              {uploading ? 'Uploading…' : awaitingSignedCopy ? 'File signed copy' : 'Attach file'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
};

export default AttachmentsPanel;
