/**
 * Opaque surface integrity
 *
 * In dark mode `--surface-bg`, `--surface-secondary` and `--surface-hover`
 * are translucent white (6%, 5%, 8%). That is deliberate for a card resting
 * on the page gradient, and wrong for anything that sits on top of other
 * content: whatever is beneath shows straight through it.
 *
 * It had shipped that way in three shapes:
 *
 * - **Pinned bars and columns** (`sticky` / `fixed`). Table rows scrolled
 *   visibly under the header; the form scrolled under its own Submit bar.
 * - **Full-screen covers.** The unconfirmed-sign-out notice exists to hide
 *   the previous member's session on a shared station computer, and in dark
 *   mode left it readable behind the message.
 * - **Dialog panels** over the modal scrim, which showed the page through
 *   the dialog body.
 *
 * Use `surface-opaque` / `surface-secondary-opaque` for an element on the
 * page that must hide what passes behind it, and `bg-theme-surface-modal`
 * (or `popover-panel`) for a dialog, sheet or menu.
 *
 * The scan reads `className` strings, so a class assembled at runtime from
 * variables is not seen. It errs toward flagging: a match is worth a look
 * even where the element happens to sit over nothing.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const STYLESHEET = path.join(SRC, 'styles', 'index.css');

/** A translucent surface fill as the element's base background, not a `hover:` or `dark:` variant. */
const TRANSLUCENT = /(?<![\w:/-])bg-theme-surface(?:-secondary|-hover)?(?:\/\d+)?(?![\w/-])/;

/** The element is pinned to the viewport or its scroll container. */
const PINNED = /(?<![\w:-])(?:fixed|sticky)(?![\w-])/;

/** The element is a dialog panel by its own utility. */
const DIALOG_PANEL = /(?<![\w:-])modal-panel(?:-scroll)?(?![\w-])/;

/** A class literal on an element: "…", '…' or a template literal. */
const CLASS_NAME = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

/** How far after a `modal-overlay` to look for the panel it contains. */
const OVERLAY_LOOKAHEAD_LINES = 8;

interface ClassLiteral {
  value: string;
  line: number;
}

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

const classLiterals = (source: string): ClassLiteral[] =>
  [...source.matchAll(CLASS_NAME)].map((match) => ({
    value: match[1] ?? match[2] ?? match[3] ?? '',
    line: source.slice(0, match.index).split('\n').length,
  }));

describe('opaque surface integrity', () => {
  const files = collectSourceFiles(SRC).map((file) => ({
    name: path.relative(SRC, file),
    literals: classLiterals(fs.readFileSync(file, 'utf8')),
  }));

  it('paints pinned and full-screen elements with an opaque surface', () => {
    const offenders = files.flatMap(({ name, literals }) =>
      literals.filter(({ value }) => PINNED.test(value) && TRANSLUCENT.test(value)).map(({ line }) => `${name}:${line}`)
    );
    expect(
      offenders,
      'A sticky or fixed element must hide what passes under it — use surface-opaque / surface-secondary-opaque, or bg-theme-surface-modal inside a dialog'
    ).toEqual([]);
  });

  it('paints dialog panels with the modal surface', () => {
    const offenders = files.flatMap(({ name, literals }) =>
      literals.flatMap(({ value, line }, index) => {
        if (DIALOG_PANEL.test(value) && TRANSLUCENT.test(value)) return [`${name}:${line}`];
        if (!/(?<![\w:-])modal-overlay(?![\w-])/.test(value)) return [];
        // A hand-rolled dialog: the first class literal after its overlay,
        // close below it, is the panel.
        const panel = literals[index + 1];
        if (panel && panel.line - line <= OVERLAY_LOOKAHEAD_LINES && TRANSLUCENT.test(panel.value)) {
          return [`${name}:${panel.line}`];
        }
        return [];
      })
    );
    expect(
      offenders,
      'A dialog, sheet or drawer over the modal scrim must be opaque — use bg-theme-surface-modal'
    ).toEqual([]);
  });

  it('keeps the stylesheet utilities for pinned bars opaque', () => {
    const css = fs.readFileSync(STYLESHEET, 'utf8');
    const offenders = [...css.matchAll(/@utility ([\w-]+) \{([^}]*)\}/g)]
      .filter(([, , body]) => {
        const applied = (body ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
        return PINNED.test(applied) && TRANSLUCENT.test(applied);
      })
      .map(([, name]) => name);
    expect(offenders, 'A sticky or fixed @utility must apply surface-opaque, not a translucent surface').toEqual([]);
  });
});
