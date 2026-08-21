import { describe, it, expect } from 'vitest';

import {
  LEGAL_SECTIONS,
  PRIVACY_POLICY_SECTIONS,
  TERMS_OF_SERVICE_SECTIONS,
  splitEmphasis,
  stripEmphasis,
  toPlainText,
  withOrgName,
} from './legalContent';

describe('legalContent', () => {
  it('substitutes the organization name everywhere it appears', () => {
    const text = toPlainText(PRIVACY_POLICY_SECTIONS, 'Falls Church VFD');
    expect(text).toContain('Falls Church VFD');
    expect(text).not.toContain('{org}');
  });

  it('splits emphasis into renderable segments', () => {
    expect(splitEmphasis('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('strips emphasis markers from plain text', () => {
    expect(stripEmphasis('**Bold** and plain')).toBe('Bold and plain');
    // A marker surviving into the export would be published literally: the
    // public page renders department text as plain paragraphs, never markup.
    expect(toPlainText(TERMS_OF_SERVICE_SECTIONS, 'Test FD')).not.toContain('**');
  });

  it('separates paragraphs the way the public page splits them', () => {
    // The page splits department-supplied text on blank lines, so a seeded
    // draft has to use the same separator or republishing it silently reflows
    // the document into one block.
    const text = toPlainText(PRIVACY_POLICY_SECTIONS, 'Test FD');
    expect(text).toContain('\n\n');
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('keeps the department-control statements in both documents', () => {
    for (const sections of Object.values(LEGAL_SECTIONS)) {
      const text = toPlainText(sections, 'Test FD');
      expect(text).toContain('Test FD holds full control of this application');
      expect(text).toContain('Access is based on your status within the department');
    }
  });

  it('leaves text without a placeholder untouched', () => {
    expect(withOrgName('no placeholder here', 'Test FD')).toBe('no placeholder here');
  });
});
