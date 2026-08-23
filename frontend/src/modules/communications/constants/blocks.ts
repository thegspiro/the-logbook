/**
 * The blocks the editor can insert, as the markup it inserts.
 *
 * This file is the single answer to "what does a correct body look like".
 * Every snippet uses only classes `DEFAULT_CSS` in `backend/app/services/
 * email_theme.py` actually defines — a class with no rule does not error, it
 * just arrives in somebody's inbox unstyled, so there is nothing to notice at
 * the moment the mistake is made.
 *
 * `backend/tests/test_email_theme_shell.py` reads this file and fails if a
 * snippet ever names a class the stylesheet dropped. That is the whole reason
 * the snippets live in a data file rather than inline in the component: a
 * palette offering a block the shell cannot style is worse than no palette,
 * because it looks like the sanctioned way to do it.
 *
 * `{accent}` is not substituted here. A body carries literal hexes because
 * there is no cascade left once the CSS is inlined, so the snippets use the
 * shell's default red and the author recolours if the notice needs it.
 */

export interface EmailBlock {
  /** Stable id, used as the React key and in tests. */
  id: string;
  label: string;
  /** Lucide icon name, resolved by the palette component. */
  icon: 'heading' | 'text' | 'table' | 'squareMousePointer' | 'alertTriangle' | 'list' | 'penLine';
  html: string;
}

export const EMAIL_BLOCKS: EmailBlock[] = [
  {
    id: 'heading',
    label: 'Section heading',
    icon: 'heading',
    html: '<h2>Section heading</h2>',
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    icon: 'text',
    html: '<p>Write the sentence a member needs to read here.</p>',
  },
  {
    id: 'details',
    label: 'Details panel',
    icon: 'table',
    html: [
      '<div class="details" style="border-left-color: #b91c1c;">',
      '    <table>',
      '        <tr><th>Label</th><td>Value</td></tr>',
      '        <tr><th>Label</th><td>Value</td></tr>',
      '    </table>',
      '</div>',
    ].join('\n'),
  },
  {
    id: 'button',
    label: 'Button',
    icon: 'squareMousePointer',
    html: '<p><a href="{{login_url}}" class="button" style="background-color: #b91c1c;" role="link">Open</a></p>',
  },
  {
    id: 'alert',
    label: 'Alert',
    icon: 'alertTriangle',
    html: ['<div class="alert">', '    <p>The thing that must not be missed.</p>', '</div>'].join('\n'),
  },
  {
    id: 'list',
    label: 'List',
    icon: 'list',
    html: ['<ul>', '    <li>First item</li>', '    <li>Second item</li>', '</ul>'].join('\n'),
  },
  {
    id: 'signature',
    label: 'Signature',
    icon: 'penLine',
    // No office variable is hard-coded here: the keys come from whichever
    // offices a department has configured, so {{chief_name}} renders blank
    // for one that calls the role something else. The Officer Signature
    // Variables panel lists the ones that actually resolve.
    html: ['<p>', '    Respectfully,<br/>', '    {{organization_name}}', '</p>'].join('\n'),
  },
];

/**
 * The seven accents, and the tint each one's chip sits on.
 *
 * Mirrors `ACCENT_*` and `CHIP_TINTS` in `backend/app/services/
 * email_theme.py`, which is the authority — the API rejects anything not in
 * that map, so a value added here alone gets a 422 rather than a new colour.
 * A test asserts the two lists match.
 *
 * These are literal hexes rather than theme tokens on purpose: they are what
 * an email renders with, and an email has no cascade to read a token from.
 */
export interface Colourway {
  accent: string;
  tint: string;
  label: string;
}

const COLOURWAY_LIST = [
  { accent: '#b91c1c', tint: '#fef2f2', label: 'Members & accounts' },
  { accent: '#b45309', tint: '#fffbeb', label: 'Training & warnings' },
  { accent: '#047857', tint: '#f0fdf4', label: 'Shifts' },
  { accent: '#1d4ed8', tint: '#eff6ff', label: 'Events & scheduling' },
  { accent: '#4338ca', tint: '#eef2ff', label: 'Elections' },
  { accent: '#6d28d9', tint: '#faf5ff', label: 'Department store' },
  { accent: '#334155', tint: '#f1f5f9', label: 'Security' },
] as const satisfies readonly Colourway[];

export const COLOURWAYS: readonly Colourway[] = COLOURWAY_LIST;

/**
 * The colourway a template with no accent set falls back to.
 *
 * A tuple-typed first element, so the chip preview never has to reach for a
 * non-null assertion on an array index — `noUncheckedIndexedAccess` is on,
 * and the assertion would be the only thing standing between a reordered
 * list and a crash.
 */
export const FALLBACK_COLOURWAY: Colourway = COLOURWAY_LIST[0];

export const EMAIL_LAYOUTS = [
  { id: 'notice', label: 'Notice', hint: 'Prose, a details panel and a button.' },
  { id: 'receipt', label: 'Receipt', hint: 'A wide items table; narrower side padding.' },
  { id: 'digest', label: 'Digest', hint: 'A run of section headings and lists.' },
] as const;

export type EmailLayout = (typeof EMAIL_LAYOUTS)[number]['id'];
