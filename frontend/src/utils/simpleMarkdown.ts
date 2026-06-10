/**
 * Simple Markdown Renderer
 *
 * Renders a small subset of markdown syntax as React elements for event
 * descriptions. XSS-safe by construction: text is rendered as React children
 * (never via innerHTML), and link URLs are restricted to http/https/mailto.
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
