import React from 'react';
import { FileText, Paperclip } from 'lucide-react';
import type { EventAttachment } from '../../../types/event';
import { fileTypeLabel } from '../../../utils/fileTypeLabel';
import { Collapsible } from '../../ux/Collapsible';
import { formatAttachmentSize, labelClass } from '../eventFormConstants';

interface AttachmentsSectionProps {
  existingAttachments: EventAttachment[];
}

/**
 * Shown only when the event already has files. Nothing here can add one, and a
 * section whose only content was "Files can't be attached from the app yet"
 * was a control wired to nothing (pitfall 19).
 */
export const AttachmentsSection: React.FC<AttachmentsSectionProps> = ({ existingAttachments }) => {
  if (existingAttachments.length === 0) return null;
  return (
    <Collapsible
      title={
        <span className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
          <Paperclip className="h-5 w-5 text-red-700" />
          <span>Attachments</span>
          <span className="bg-theme-surface-secondary text-theme-text-muted ml-2 rounded-full px-2 py-0.5 text-xs font-normal">
            {existingAttachments.length}
          </span>
        </span>
      }
      defaultOpen
    >
      <div className="space-y-4">
        {/* Existing attachments (editing mode) */}
        <div className="space-y-2">
          <label className={labelClass}>Current Attachments</label>
          <ul className="divide-theme-surface-border border-theme-surface-border divide-y overflow-hidden rounded-lg border">
            {existingAttachments.map((attachment) => (
              <li
                key={attachment.id}
                className="bg-theme-surface hover:bg-theme-surface-hover flex items-center justify-between px-4 py-3 transition-colors"
              >
                <div className="flex min-w-0 items-center space-x-3">
                  <FileText className="text-theme-text-muted h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-theme-text-primary truncate text-sm font-medium">{attachment.file_name}</p>
                    <p className="text-theme-text-muted text-xs">
                      {formatAttachmentSize(attachment.file_size)} &middot; {fileTypeLabel(attachment.file_type)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Collapsible>
  );
};
