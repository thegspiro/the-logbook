/**
 * EventAttachmentsList
 *
 * Displays event file attachments with download links.
 */

import React from 'react';
import { Paperclip, Download } from 'lucide-react';
import { EmptyState } from '../ux';
import type { EventAttachment } from '../../types/event';

export interface EventAttachmentsListProps {
  attachments: EventAttachment[];
  eventId: string;
  getAttachmentDownloadUrl: (eventId: string, attachmentId: string) => string;
}

export const EventAttachmentsList: React.FC<EventAttachmentsListProps> = ({
  attachments,
  eventId,
  getAttachmentDownloadUrl,
}) => {
  if (attachments.length === 0) {
    return (
      <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
          <Paperclip className="h-5 w-5" />
          Attachments
        </h2>
        <EmptyState
          icon={Paperclip}
          title="No attachments"
          description="No files have been attached to this event."
        />
      </div>
    );
  }

  return (
    <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
      <h2 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
        <Paperclip className="h-5 w-5" />
        Attachments ({attachments.length})
      </h2>
      <div className="space-y-2">
        {attachments.map((attachment) => (
          <div key={attachment.id} className="flex items-center justify-between p-3 bg-theme-surface-secondary rounded-lg">
            <div className="flex items-center gap-3 min-w-0">
              <Paperclip className="h-4 w-4 text-theme-text-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-theme-text-primary truncate">{attachment.file_name}</p>
                <p className="text-xs text-theme-text-muted">
                  {attachment.file_size < 1024 * 1024
                    ? `${Math.round(attachment.file_size / 1024)} KB`
                    : `${(attachment.file_size / (1024 * 1024)).toFixed(1)} MB`}
                </p>
              </div>
            </div>
            <a
              href={getAttachmentDownloadUrl(eventId, attachment.id)}
              className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              download
            >
              <Download className="h-4 w-4" />
              Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
};
