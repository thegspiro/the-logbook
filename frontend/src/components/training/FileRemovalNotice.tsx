import React from 'react';
import { FileX } from 'lucide-react';

import { useTimezone } from '../../hooks/useTimezone';
import type { FileRemovalReason } from '../../types/training';
import { fileRemovalText } from '../../utils/fileRemoval';

interface FileRemovalNoticeProps {
  removedAt: string | null | undefined;
  reason: FileRemovalReason | null | undefined;
  className?: string;
}

/** Why a certificate file is no longer there; see `fileRemovalText`. */
export const FileRemovalNotice: React.FC<FileRemovalNoticeProps> = ({ removedAt, reason, className }) => {
  const tz = useTimezone();
  return (
    <span className={`text-theme-text-muted inline-flex items-start gap-1.5 text-sm ${className ?? ''}`}>
      <FileX className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{fileRemovalText(removedAt, reason, tz)}</span>
    </span>
  );
};

export default FileRemovalNotice;
