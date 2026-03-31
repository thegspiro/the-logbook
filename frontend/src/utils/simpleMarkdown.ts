/**
 * Simple Markdown Renderer
 *
 * Converts a small subset of markdown syntax to HTML or React elements for
 * event descriptions. Sanitizes HTML first (escapes angle brackets and
 * ampersands) to prevent XSS, then applies markdown conversions.
 *
 * Supported syntax:
 * - **bold** → <strong>bold</strong>
 * - *italic* → <em>italic</em>
 * - [text](url) → <a href="url">text</a>
 * - Lines starting with "- " → <ul><li>…</li></ul>
 * - Newlines → <br>
 */

import React from 'react';

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate that a URL is safe (http, https, or mailto only).
 */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Convert simple markdown text to sanitized HTML.
 *
 * The input is first HTML-escaped, then markdown patterns are converted.
 * This ensures no raw HTML can be injected.
 */
export function renderSimpleMarkdown(text: string): string {
  // First, escape all HTML
  let html = escapeHtml(text);

  // Convert **bold** (must come before italic to avoid conflict)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert *italic* (single asterisks, not preceded/followed by another asterisk)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Convert [text](url) links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match: string, linkText: string, url: string) => {
      if (isSafeUrl(url)) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300">${linkText}</a>`;
      }
      return linkText;
    },
  );

  // Convert bullet lists: lines starting with "- "
  // Split into lines, group consecutive bullet lines into <ul> blocks
  const lines = html.split('\n');
  const result: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (!inList) {
        result.push('<ul class="list-disc list-inside my-1">');
        inList = true;
      }
      result.push(`<li>${line.slice(2)}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(line);
    }
  }
  if (inList) {
    result.push('</ul>');
  }

  // Join lines back and convert remaining newlines to <br>
  // But don't add <br> right after </ul> or </li> or before <ul>
  html = result
    .join('\n')
    .replace(/\n(?!<\/?(?:ul|li))/g, '<br>')
    .replace(/(<\/ul>)\n/g, '$1')
    .replace(/\n(<ul)/g, '$1');

  return html;
}

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'link';
  content: string;
  href?: string;
}

/**
 * Parse inline markdown tokens (bold, italic, links) from a plain-text string.
 * Returns an array of typed tokens for React rendering.
 */
function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const boldContent = match[1];
    const italicContent = match[2];
    const linkText = match[3];
    const linkUrl = match[4];

    if (boldContent !== undefined) {
      tokens.push({ type: 'bold', content: boldContent });
    } else if (italicContent !== undefined) {
      tokens.push({ type: 'italic', content: italicContent });
    } else if (linkText !== undefined && linkUrl !== undefined) {
      if (isSafeUrl(linkUrl)) {
        tokens.push({ type: 'link', content: linkText, href: linkUrl });
      } else {
        tokens.push({ type: 'text', content: linkText });
      }
    }

    lastIndex = match.index + (match[0]?.length ?? 0);
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return tokens;
}

function renderInlineTokens(tokens: InlineToken[], keyPrefix: string): React.ReactNode[] {
  return tokens.map((token, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (token.type) {
      case 'bold':
        return React.createElement('strong', { key }, token.content);
      case 'italic':
        return React.createElement('em', { key }, token.content);
      case 'link':
        return React.createElement(
          'a',
          {
            key,
            href: token.href,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-300',
          },
          token.content,
        );
      default:
        return React.createElement(React.Fragment, { key }, token.content);
    }
  });
}

interface SimpleMarkdownProps {
  text: string;
  className?: string;
}

/**
 * React component that renders a simple markdown subset without
 * dangerouslySetInnerHTML. Supports bold, italic, links, bullet lists,
 * and newline breaks.
 */
export const SimpleMarkdown: React.FC<SimpleMarkdownProps> = ({ text, className }) => {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];
  let blockIndex = 0;

  const flushList = () => {
    if (currentListItems.length > 0) {
      blocks.push(
        React.createElement(
          'ul',
          { key: `block-${blockIndex}`, className: 'list-disc list-inside my-1' },
          ...currentListItems,
        ),
      );
      blockIndex++;
      currentListItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (line.startsWith('- ')) {
      const content = line.slice(2);
      const tokens = parseInlineTokens(content);
      currentListItems.push(
        React.createElement('li', { key: `li-${i}` }, ...renderInlineTokens(tokens, `li-${i}`)),
      );
    } else {
      flushList();

      const tokens = parseInlineTokens(line);
      const inlineElements = renderInlineTokens(tokens, `line-${i}`);
      blocks.push(React.createElement(React.Fragment, { key: `block-${blockIndex}` }, ...inlineElements));
      blockIndex++;

      const nextLine = lines[i + 1];
      const nextIsList = nextLine !== undefined && nextLine.startsWith('- ');
      if (i < lines.length - 1 && !nextIsList) {
        blocks.push(React.createElement('br', { key: `br-${blockIndex}` }));
        blockIndex++;
      }
    }
  }

  flushList();

  return React.createElement('div', { className }, ...blocks);
};
