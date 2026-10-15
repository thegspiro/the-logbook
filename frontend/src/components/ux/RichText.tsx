/**
 * Read-only display of a minutes section.
 *
 * Plain text (every section written before the editor existed) is shown as
 * typed, with its line breaks. Rich text is the editor's HTML subset, cleaned
 * again here before it reaches the page.
 */

import React, { useMemo } from 'react';
import { sanitizeRichText, type TextFormat } from '../../utils/richText';

interface RichTextProps {
  content: string;
  format?: TextFormat | undefined;
  className?: string;
}

export const RichText: React.FC<RichTextProps> = ({ content, format, className = '' }) => {
  const html = useMemo(() => (format === 'html' ? sanitizeRichText(content) : ''), [content, format]);

  if (format !== 'html') {
    return <div className={`whitespace-pre-wrap ${className}`}>{content}</div>;
  }
  return (
    // Safe by construction: `html` is the output of DOMPurify with a fixed
    // allowlist of tags, no attributes but `href`, and http/https/mailto links.
    <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
  );
};

export default RichText;
