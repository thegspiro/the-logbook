/**
 * Dialog semantics integrity
 *
 * `DialogPanel` supplies a dialog's behaviour — focus trap, Escape, scroll lock
 * — but not its semantics, because the 52 call sites put them in two places:
 * on the panel, or on the fixed wrapper around the overlay and panel. Both are
 * valid. What is not is neither: the Reports results dialog and the scan
 * modal's confirmations announced as an unlabelled group, and five more had a
 * role with no accessible name, so a screen reader said "dialog" and nothing
 * else (WCAG 4.1.2).
 *
 * This walks the source and requires each `<DialogPanel` to carry a dialog
 * role, `aria-modal` and a name — on its own props, or within the lines just
 * above it, where its wrapper opens. It is a static heuristic, not a parse: a
 * role belonging to a different dialog close above could satisfy it. It exists
 * to stop the common case, a new dialog shipped with no semantics at all.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** How far above the panel its wrapper's opening tag may sit. */
const WRAPPER_WINDOW = 40;

const ROLE = /role=["'](?:alert)?dialog["']/;
const MODAL = /aria-modal=/;
const NAME = /aria-label(?:ledby)?=/;

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

/** The panel's own opening tag, through the line that closes it. */
const panelProps = (lines: string[], start: number): string => {
  let props = '';
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    props += `${line}\n`;
    if (/>\s*$/.test(line)) break;
  }
  return props;
};

const missingSemantics = (source: string): number[] => {
  const lines = source.split('\n');
  const offenders: number[] = [];
  lines.forEach((line, index) => {
    if (!line.includes('<DialogPanel')) return;
    const context = panelProps(lines, index) + lines.slice(Math.max(0, index - WRAPPER_WINDOW), index).join('\n');
    if (!(ROLE.test(context) && MODAL.test(context) && NAME.test(context))) offenders.push(index + 1);
  });
  return offenders;
};

describe('dialog semantics integrity', () => {
  it('gives every DialogPanel a dialog role, aria-modal and an accessible name', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      if (file.endsWith(path.join('components', 'ux', 'DialogPanel.tsx'))) continue;
      for (const line of missingSemantics(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    expect(
      offenders,
      'Add role="dialog" aria-modal="true" and aria-labelledby (pointing at the visible heading) to the panel or its wrapper'
    ).toEqual([]);
  });

  it('detects a panel with no semantics, and accepts either placement', () => {
    expect(missingSemantics('<div>\n  <DialogPanel onClose={close}>\n    <h2>Title</h2>')).toEqual([2]);
    expect(
      missingSemantics('<div role="dialog" aria-modal="true" aria-labelledby="t">\n  <DialogPanel onClose={close}>')
    ).toEqual([]);
    expect(
      missingSemantics('<DialogPanel\n  onClose={close}\n  role="dialog"\n  aria-modal="true"\n  aria-label="Pick"\n>')
    ).toEqual([]);
    expect(missingSemantics('<div role="dialog" aria-modal="true">\n  <DialogPanel onClose={close}>')).toEqual([2]);
  });
});
