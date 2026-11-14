import React from 'react';

import { parseLegalMarkup } from './legalMarkup';
import { bodyText, listClass, orderedListClass, sectionHeading, subsectionHeading } from './legalStyles';

/**
 * Department-supplied legal text, with its headings and lists applied.
 *
 * The one renderer for that text wherever it is shown — the public /privacy
 * and /terms pages (and so their printout), and Governance → Legal Documents —
 * so a publisher reviewing a proposal sees what members will see. Every
 * string reaches the page as a React text node; see legalMarkup.ts for why
 * that, not a sanitizer, is what keeps markup out.
 */
interface LegalMarkupProps {
  text: string;
  className?: string | undefined;
  /**
   * The element a `##` heading becomes (`###` is one level below). The public
   * page's title is the h1, so 2 there; inside a screen whose own section
   * heading is an h2, pass 3 so the outline stays in order.
   */
  headingLevel?: 2 | 3 | undefined;
}

const LegalMarkup: React.FC<LegalMarkupProps> = ({ text, className, headingLevel = 2 }) => (
  <div className={className}>
    {parseLegalMarkup(text).map((block, i) => {
      if (block.kind === 'heading') {
        const level = headingLevel + block.level - 2;
        const Tag = level === 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
        return (
          <Tag key={i} className={block.level === 2 ? sectionHeading : subsectionHeading}>
            {block.text}
          </Tag>
        );
      }
      if (block.kind === 'ul') {
        return (
          <ul key={i} className={listClass}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        );
      }
      if (block.kind === 'ol') {
        return (
          <ol key={i} className={orderedListClass} start={block.start}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        );
      }
      return (
        <p key={i} className={`${bodyText} whitespace-pre-line`}>
          {block.text}
        </p>
      );
    })}
  </div>
);

export default LegalMarkup;
