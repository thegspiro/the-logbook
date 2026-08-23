import React from 'react';

import { splitEmphasis, withOrgName, type LegalBlock, type LegalSection } from './legalContent';
import { bodyText, calloutClass, listClass, sectionHeading } from './legalStyles';

/**
 * Renders the structured legal content (legalContent.ts) as the public page.
 *
 * The same sections are exported as plain text to seed an editable draft in
 * Governance → Legal Documents, so a department adapting the wording starts
 * from what is actually published rather than from a retyped copy.
 */

/** Content string with `{org}` substituted and `**bold**` turned into <strong>. */
const Emphasized: React.FC<{ text: string; orgName: string }> = ({ text, orgName }) => (
  <>
    {splitEmphasis(withOrgName(text, orgName)).map((segment, i) =>
      segment.bold ? <strong key={i}>{segment.text}</strong> : <React.Fragment key={i}>{segment.text}</React.Fragment>
    )}
  </>
);

const Block: React.FC<{ block: LegalBlock; orgName: string }> = ({ block, orgName }) => {
  if (block.kind === 'p') {
    return (
      <p className={bodyText}>
        <Emphasized text={block.text} orgName={orgName} />
      </p>
    );
  }
  if (block.kind === 'ul') {
    return (
      <ul className={listClass}>
        {block.items.map((item, i) => (
          <li key={i}>
            <Emphasized text={item} orgName={orgName} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={calloutClass}>
      {block.paragraphs.map((paragraph, i) => (
        <p key={i} className={i === 0 ? undefined : 'mt-3'}>
          <Emphasized text={paragraph} orgName={orgName} />
        </p>
      ))}
    </div>
  );
};

const LegalSections: React.FC<{ sections: LegalSection[]; orgName: string }> = ({ sections, orgName }) => (
  <>
    {sections.map((section, i) => (
      <React.Fragment key={i}>
        {section.heading ? <h2 className={sectionHeading}>{section.heading}</h2> : null}
        {section.blocks.map((block, j) => (
          <Block key={j} block={block} orgName={orgName} />
        ))}
      </React.Fragment>
    ))}
  </>
);

export default LegalSections;
