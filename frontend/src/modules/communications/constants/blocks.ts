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
