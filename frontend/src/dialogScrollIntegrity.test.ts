/**
 * Dialog scroll integrity
 *
 * A dialog panel centred by a `fixed inset-0 flex items-center` container and
 * given no height cap does not fail loudly either: on a viewport shorter than
 * the panel it overflows the container in BOTH directions, so the title sits
 * above the top of the screen and the action row below the bottom, and neither
 * can be scrolled to — the fixed container itself never overflows, so no
 * scrollbar appears anywhere. To the user it is a box that cannot be
 * interacted with. A phone in landscape is 390px tall, so dialogs that are
 * comfortable in portrait hit it, and `items-end` sheets overflow upward the
 * same way.
 *
 * `modal-panel-scroll` in styles/index.css is the fix, but a utility does not
 * stop the next hand-rolled dialog from omitting it. This walks the source and
 * checks that every such container's panel caps its height somehow.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Any of these on the panel means its height is bounded and it scrolls. */
const CAPPED = ['modal-panel-scroll', 'modal-body', 'max-h-', 'overflow-y-auto', 'overflow-auto'];

/** A full-viewport dialog/sheet container that centres or bottom-anchors its panel. */
const CONTAINER = /className=\{?[`"']([^`"']*(?:modal-overlay|fixed inset-0)[^`"']*)[`"']/g;

/** Every className string, used to walk forward from a container to its panel. */
const ANY_CLASS = /className=\{?[`"']([^`"']*)[`"']/g;

const collectSourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // e2e specs drive a real browser, not this markup.
      if (entry.name !== 'e2e') found.push(...collectSourceFiles(full));
    } else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
};

/**
 * The scrim is frequently an empty sibling rendered before the panel, so the
 * first className after the container is not reliably the panel's.
 */
const isScrim = (cls: string): boolean => cls.includes('modal-overlay') || cls.includes('absolute inset-0');

const findPanelClass = (source: string, from: number): string | null => {
  ANY_CLASS.lastIndex = from;
  for (let i = 0; i < 3; i++) {
    const match = ANY_CLASS.exec(source);
    if (!match) return null;
    const cls = match[1] ?? '';
    if (!isScrim(cls)) return cls;
  }
  return null;
};

const files = collectSourceFiles(SRC);

interface Offender {
  file: string;
  line: number;
  panel: string;
}

const findOffenders = (): Offender[] => {
  const offenders: Offender[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    CONTAINER.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CONTAINER.exec(source)) !== null) {
      const container = match[1] ?? '';

      // Only flex-positioned panels are at risk; a container that scrolls its
      // own content in normal flow reaches both ends fine.
      if (!container.includes('items-center') && !container.includes('items-end')) continue;
      // A container that scrolls, or one that ignores pointer events entirely
      // (a flash or spinner overlay), is not this defect.
      if (CAPPED.some((token) => container.includes(token))) continue;
      if (container.includes('pointer-events-none')) continue;

      const panel = findPanelClass(source, match.index + match[0].length);
      if (panel === null) continue;
      if (CAPPED.some((token) => panel.includes(token))) continue;

      offenders.push({
        file: path.relative(SRC, file),
        line: source.slice(0, match.index).split('\n').length,
        panel,
      });
    }
  }

  return offenders;
};

describe('dialog scroll integrity', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('caps the height of every panel centred inside a fixed overlay', () => {
    const offenders = findOffenders();
    const report = offenders.map((o) => `${o.file}:${o.line} — panel has no height cap: "${o.panel}"`);

    expect(
      report,
      'Add `modal-panel-scroll` to the dialog panel (see styles/index.css). Without a height cap ' +
        'a panel taller than the viewport puts its title above the screen and its buttons below it, ' +
        'with nothing to scroll.'
    ).toEqual([]);
  });
});
