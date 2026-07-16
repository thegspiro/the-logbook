/**
 * LinkifiedText
 *
 * Renders plain text with http(s) URLs turned into clickable links. Safe by
 * construction: the text is emitted as React text nodes (which React escapes),
 * never via dangerouslySetInnerHTML, so message bodies can't inject markup.
 *
 * Whitespace/line breaks are preserved by the *parent* element's CSS
 * (e.g. `whitespace-pre-wrap`), so callers keep their existing wrapper.
 */

import React from 'react';

const URL_RE = /https?:\/\/[^\s]+/g;
// Punctuation that commonly trails a URL in prose but isn't part of it.
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;

interface LinkifiedTextProps {
  text: string;
  /** Class applied to generated <a> elements. */
  linkClassName?: string;
}

const DEFAULT_LINK_CLASS = 'text-theme-info underline underline-offset-2 hover:no-underline';

export const LinkifiedText: React.FC<LinkifiedTextProps> = ({ text, linkClassName }) => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  const re = new RegExp(URL_RE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    let url = match[0];
    let end = start + url.length;

    // Keep trailing sentence punctuation out of the href (and out of the link).
    const trailing = url.match(TRAILING_PUNCT_RE)?.[0] ?? '';
    if (trailing) {
      url = url.slice(0, url.length - trailing.length);
      end -= trailing.length;
    }

    if (start > lastIndex) {
      nodes.push(<React.Fragment key={key++}>{text.slice(lastIndex, start)}</React.Fragment>);
    }
    nodes.push(
      <a
        key={key++}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={linkClassName ?? DEFAULT_LINK_CLASS}
      >
        {url}
      </a>,
    );
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    nodes.push(<React.Fragment key={key++}>{text.slice(lastIndex)}</React.Fragment>);
  }

  return <>{nodes}</>;
};

export default LinkifiedText;
