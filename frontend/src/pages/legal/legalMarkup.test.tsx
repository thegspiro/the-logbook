import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import LegalMarkup from './LegalMarkup';
import { parseLegalMarkup } from './legalMarkup';
import { LEGAL_SECTIONS, toPlainText } from './legalContent';

/**
 * Owner decision W54-5 (2026-11-01): department legal text may use headings
 * and lists, and everything else is shown as typed. The XSS cases are the
 * point — this text is rendered on the one page every visitor can reach.
 */

describe('parseLegalMarkup', () => {
  it('reads headings, lists and paragraphs', () => {
    expect(
      parseLegalMarkup(
        '## Data we hold\n\nIntro line one.\nline two.\n\n- Name\n- Phone\n\n1. First\n2. Second\n\n### Detail'
      )
    ).toEqual([
      { kind: 'heading', level: 2, text: 'Data we hold' },
      { kind: 'paragraph', text: 'Intro line one.\nline two.' },
      { kind: 'ul', items: ['Name', 'Phone'] },
      { kind: 'ol', start: 1, items: ['First', 'Second'] },
      { kind: 'heading', level: 3, text: 'Detail' },
    ]);
  });

  it('treats a single # as a section heading, never the page title', () => {
    expect(parseLegalMarkup('# Top')).toEqual([{ kind: 'heading', level: 2, text: 'Top' }]);
  });

  it('accepts * bullets and 1) numbering, keeping the starting number', () => {
    expect(parseLegalMarkup('* a\n* b\n\n3) c\n4) d')).toEqual([
      { kind: 'ul', items: ['a', 'b'] },
      { kind: 'ol', start: 3, items: ['c', 'd'] },
    ]);
  });

  it('continues an item on an indented line and ends the list on an unindented one', () => {
    expect(parseLegalMarkup('- first item\n  wraps here\nAfter the list.')).toEqual([
      { kind: 'ul', items: ['first item wraps here'] },
      { kind: 'paragraph', text: 'After the list.' },
    ]);
  });

  it('leaves marks that are not the subset as text', () => {
    // No space after the marker, a bare marker, and a hyphenated word.
    expect(parseLegalMarkup('#hashtag\n-dash\n##\nwell-known')).toEqual([
      { kind: 'paragraph', text: '#hashtag\n-dash\n##\nwell-known' },
    ]);
  });

  it('handles Windows line endings', () => {
    expect(parseLegalMarkup('## A\r\n\r\n- b\r\n- c')).toEqual([
      { kind: 'heading', level: 2, text: 'A' },
      { kind: 'ul', items: ['b', 'c'] },
    ]);
  });
});

/**
 * The rendered markup as an HTML string. A tag in the payload that React
 * escaped serializes as `&lt;…`, so any `<tag` in this string is an element
 * the renderer actually created.
 */
const renderedHtml = (text: string, headingLevel?: 2 | 3): string =>
  render(<LegalMarkup text={text} headingLevel={headingLevel} />).asFragment().firstElementChild?.outerHTML ?? '';

/** Every element and attribute name in serialized HTML. */
const tagsAndAttributes = (html: string): { tags: string[]; attributes: string[] } => {
  const tags: string[] = [];
  const attributes: string[] = [];
  for (const match of html.matchAll(/<([a-z0-9]+)([^>]*)>/g)) {
    tags.push(match[1] ?? '');
    for (const attribute of (match[2] ?? '').matchAll(/\s([^\s=]+)=/g)) attributes.push(attribute[1] ?? '');
  }
  return { tags, attributes };
};

describe('LegalMarkup', () => {
  it('renders headings and lists as real elements', () => {
    render(<LegalMarkup text={'## Your rights\n\n- Access\n- Correction\n\n1. Ask\n2. Wait'} />);
    expect(screen.getByRole('heading', { name: 'Your rights', level: 2 })).toBeInTheDocument();
    const [bulleted, numbered] = screen.getAllByRole('list');
    expect(bulleted?.tagName).toBe('UL');
    expect(
      within(bulleted as HTMLElement)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Access', 'Correction']);
    expect(numbered?.tagName).toBe('OL');
    expect(
      within(numbered as HTMLElement)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Ask', 'Wait']);
  });

  it('shifts headings down a level inside a screen with its own h2', () => {
    render(<LegalMarkup text={'## Section\n\n### Sub'} headingLevel={3} />);
    expect(screen.getByRole('heading', { name: 'Section', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sub', level: 4 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  describe('neutralizes markup', () => {
    const attacks: Record<string, string> = {
      'a script tag': '<script>alert(1)</script>',
      'an event handler': '<img src=x onerror="alert(1)">',
      'a javascript: link': '<a href="javascript:alert(1)">Click</a>',
      'a markdown javascript: link': '[Click](javascript:alert(1))',
      'an svg onload': '<svg onload=alert(1)></svg>',
      'a split tag': '<scr<script>ipt>alert(1)</scr</script>ipt>',
      'an entity-encoded tag': '&lt;script&gt;alert(1)&lt;/script&gt;',
      'an iframe': '<iframe src="javascript:alert(1)"></iframe>',
      'a style tag': '<style>body{display:none}</style>',
      'markup in a heading': '## <img src=x onerror=alert(1)>Title',
      'markup in a list item': '- <a href="javascript:alert(1)">x</a>\n- <script>alert(2)</script>',
      'markup in a numbered item': '1. <svg><script>alert(1)</script></svg>',
      'markup in a continuation line': '- item\n  <img src=x onerror=alert(1)>',
    };

    for (const [name, payload] of Object.entries(attacks)) {
      it(`shows ${name} as text`, () => {
        const { tags, attributes } = tagsAndAttributes(renderedHtml(payload));
        // Only the elements the subset produces, and only class names and a
        // numbered list's start — nothing from the payload became markup.
        expect(tags.filter((tag) => !['div', 'p', 'h2', 'h3', 'ul', 'ol', 'li'].includes(tag))).toEqual([]);
        expect(attributes.filter((attribute) => !['class', 'start'].includes(attribute))).toEqual([]);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
      });
    }

    it('shows the characters typed, as text', () => {
      render(<LegalMarkup text={'<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>'} />);
      expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
      expect(screen.getByText('<img src=x onerror=alert(1)>').tagName).toBe('LI');
    });

    it('keeps a numbered list start numeric', () => {
      render(<LegalMarkup text="7. seven" />);
      expect(screen.getByRole('list')).toHaveAttribute('start', '7');
    });
  });
});

describe('the seed text for a new proposal', () => {
  it('carries the built-in headings and lists in the supported subset', () => {
    for (const sections of Object.values(LEGAL_SECTIONS)) {
      const blocks = parseLegalMarkup(toPlainText(sections, 'Test FD'));
      const headings = blocks.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.text : ''));
      expect(headings).toEqual(sections.flatMap((s) => (s.heading ? [s.heading] : [])));
      const listItems = blocks.flatMap((b) => (b.kind === 'ul' ? b.items : []));
      expect(listItems.length).toBe(
        sections.flatMap((s) => s.blocks).reduce((n, b) => n + (b.kind === 'ul' ? b.items.length : 0), 0)
      );
    }
  });
});
