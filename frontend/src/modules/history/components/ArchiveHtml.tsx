import React, { useMemo } from 'react';
import { sanitizeArchiveHtml } from '../utils/historyFormat';

interface ArchiveHtmlProps {
  html: string | null | undefined;
  className?: string;
}

/** A biography (or later, an article) as the server rendered it. */
export const ArchiveHtml: React.FC<ArchiveHtmlProps> = ({ html, className = '' }) => {
  const clean = useMemo(() => (html ? sanitizeArchiveHtml(html) : ''), [html]);
  if (!clean) return null;
  return (
    // Safe by construction: rendered server-side from Markdown with raw HTML
    // off and cleaned there, then cleaned again here by DOMPurify against the
    // same allowlist.
    <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />
  );
};
