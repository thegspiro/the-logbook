/**
 * EventAttachmentsList
 *
 * Displays event file attachments with download links. For someone who
 * manages events it also attaches and removes files (2026-10-31): the API has
 * always accepted them, and until now nothing on screen could send one.
 */

import React, { useRef, useState } from 'react';
import { Paperclip, Download, Trash2, Upload } from 'lucide-react';
import { EmptyState } from '../ux';
import type { EventAttachment } from '../../types/event';

/** What the server accepts (EVENT_ATTACHMENT_RULES in endpoints/events.py). */
export const EVENT_ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif';
export const EVENT_ATTACHMENT_MAX_MB = 25;

export interface EventAttachmentsListProps {
  attachments: EventAttachment[];
  eventId: string;
  getAttachmentDownloadUrl: (eventId: string, attachmentId: string) => string;
  /** Present for someone who manages events; resolves once the file is stored. */
  onUpload?: ((file: File) => Promise<void>) | undefined;
  /** Present for someone who manages events; asks before removing. */
  onDelete?: ((attachment: EventAttachment) => Promise<void>) | undefined;
}

export const EventAttachmentsList: React.FC<EventAttachmentsListProps> = ({
  attachments,
  eventId,
  getAttachmentDownloadUrl,
  onUpload,
  onDelete,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file || !onUpload) return;
    setSizeError(null);
    // Checked here as well as on the server, so a large file is refused before
    // it is sent rather than after a long upload.
    if (file.size > EVENT_ATTACHMENT_MAX_MB * 1024 * 1024) {
      setSizeError(`${file.name} is larger than ${EVENT_ATTACHMENT_MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const attachControl = onUpload ? (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        accept={EVENT_ATTACHMENT_ACCEPT}
        className="sr-only"
        id={`event-attachment-${eventId}`}
        aria-label="Attach a file"
        onChange={(e) => void handleFile(e.target.files?.[0])}
        disabled={uploading}
      />
      <label
        htmlFor={`event-attachment-${eventId}`}
        className={`btn-primary inline-flex cursor-pointer items-center gap-1.5 text-sm ${uploading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {uploading ? 'Uploading…' : 'Attach file'}
      </label>
      <p className="text-theme-text-muted mt-1 text-xs">
        PDF, Office documents, text, CSV or images, up to {EVENT_ATTACHMENT_MAX_MB} MB. Anyone who can see the event can
        download them.
      </p>
      {sizeError && (
        <p className="mt-1 text-xs text-red-700 dark:text-red-400" role="alert">
          {sizeError}
        </p>
      )}
    </div>
  ) : null;

  if (attachments.length === 0) {
    return (
      <div className="card p-6">
        <h2 className="text-theme-text-primary mb-4 flex items-center gap-2 text-lg font-medium">
          <Paperclip className="h-5 w-5" />
          Attachments
        </h2>
        {attachControl}
        <EmptyState
          icon={Paperclip}
          title="No attachments"
          description="No files have been attached to this event."
          headingLevel={3}
        />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-theme-text-primary mb-4 flex items-center gap-2 text-lg font-medium">
        <Paperclip className="h-5 w-5" />
        Attachments ({attachments.length})
      </h2>
      {attachControl}
      <div className="space-y-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="bg-theme-surface-secondary flex items-center justify-between gap-2 rounded-lg p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Paperclip className="text-theme-text-muted h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-theme-text-primary truncate text-sm font-medium">{attachment.file_name}</p>
                <p className="text-theme-text-muted text-xs">
                  {attachment.file_size < 1024 * 1024
                    ? `${Math.round(attachment.file_size / 1024)} KB`
                    : `${(attachment.file_size / (1024 * 1024)).toFixed(1)} MB`}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={getAttachmentDownloadUrl(eventId, attachment.id)}
                className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                download
              >
                <Download className="h-4 w-4" />
                Download
              </a>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => void onDelete(attachment)}
                  className="btn-icon text-theme-text-muted hover:text-red-700"
                  aria-label={`Remove ${attachment.file_name}`}
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
