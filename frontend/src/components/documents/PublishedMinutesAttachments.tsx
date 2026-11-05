import React, { useState } from 'react';
import { Download, Paperclip } from 'lucide-react';
import { Modal } from '../Modal';
import { documentsService } from '../../services/api';
import type { PublishedMinutesAttachment } from '../../services/documentsService';

interface PublishedMinutesAttachmentsProps {
  documentId: string;
  documentName: string;
}

const sizeLabel = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The files filed with a set of minutes, opened from their published copy
 * (owner decision 2026-11-01). The server serves them under the document's own
 * folder rules and only those the published copy lists, so this shows exactly
 * what a reader of the document may open. Nothing is fetched until opened.
 */
export const PublishedMinutesAttachments: React.FC<PublishedMinutesAttachmentsProps> = ({
  documentId,
  documentName,
}) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PublishedMinutesAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setItems(null);
    try {
      setItems(await documentsService.getPublishedMinutesAttachments(documentId));
    } catch {
      setError('Could not load the attachments. Check your connection and try again.');
    }
  };

  const handleOpen = () => {
    setOpen(true);
    void load();
  };

  const handleDownload = async (item: PublishedMinutesAttachment) => {
    setError(null);
    try {
      const blob = await documentsService.downloadPublishedMinutesAttachment(documentId, item.id);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = item.original_name || item.title;
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(`Could not download ${item.title}. Check your connection and try again.`);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleOpen();
        }}
        className="text-theme-text-muted touch-target-phone p-1 transition-colors hover:text-amber-700 dark:hover:text-amber-400"
        title="Attachments"
        aria-label={`Attachments of ${documentName}`}
      >
        <Paperclip className="h-4 w-4" aria-hidden="true" />
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} title={`Attachments — ${documentName}`} size="md">
        {error && (
          <p className="alert-error mb-3 p-3 text-sm" role="alert">
            {error}
          </p>
        )}
        {items === null && !error && <p className="text-theme-text-muted text-sm">Loading…</p>}
        {items !== null && items.length === 0 && (
          <p className="text-theme-text-muted text-sm">No files were published with these minutes.</p>
        )}
        {items !== null && items.length > 0 && (
          <ul className="divide-theme-surface-border divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary font-medium break-words">{item.title}</p>
                  <p className="text-theme-text-muted text-xs break-words">
                    {item.original_name} · {sizeLabel(item.file_size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownload(item)}
                  className="btn-icon text-theme-text-muted hover:text-amber-700 dark:hover:text-amber-400"
                  aria-label={`Download ${item.title}`}
                  title="Download"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
};

export default PublishedMinutesAttachments;
