/**
 * Dialog dismissal integrity
 *
 * A dialog in this app is nearly always a form, and the click target for
 * "outside" is the gutter around the panel. A click there is far more often a
 * slip than an intent to discard, and there is nothing to undo it with: no
 * draft is persisted, and callers routinely reset their form state inside
 * `onClose` — `GrantDetailPage`'s shared shell called `resetBudgetForm()`,
 * `IntegrationsPage` called `resetFormState()`, `EventsPage` blanked the import
 * file input. The reported case was the inventory Add Item dialog, where a
 * stray click threw away a name, a category, every selected size and every
 * garment style axis and reopened blank.
 *
 * `components/Modal.tsx` now defaults `closeOnClickOutside` to false, which
 * covers its ~99 call sites. It does nothing for the hand-rolled overlays that
 * never route through it, and nothing stops a future one from re-enabling it.
 * This walks the source and checks both.
 *
 * Transient surfaces with nothing to lose — a command palette, a picker, a
 * jump sheet — are allowed to keep click-away, by name, in ALLOWED below.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Surfaces permitted to dismiss on an outside click. Each holds no user input,
 * so a stray click costs a reopen and nothing else.
 *
 * Note that the patterns below cannot tell a dialog from a menu — a dropdown's
 * dismiss scrim is the same `fixed inset-0` + `onClick` markup — so the menus
 * are listed too. Click-away is how a menu is *supposed* to close; they are
 * here to be exempted, not because they were ever the problem.
 */
const ALLOWED = new Set([
  // --- Dialogs and sheets that hold no user input ---
  // Opened with a keystroke and dismissed the same way; click-away is expected.
  'components/ux/CommandPalette.tsx',
  // "Jump to a stop" / flat-list navigation sheets over a check in progress.
  'modules/inventory/pages/CheckJumpSheet.tsx',
  // "Pick a checklist" template picker.
  'modules/inventory/pages/MyChecklistsPage.tsx',
  // The "Before publishing" blocker sheet, which only lists what is unfinished.
  // The template details drawer in the same file holds inputs and is NOT
  // dismissible, so this entry is deliberately file-scoped and not a licence to
  // add another dismissible dialog here.
  'modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx',

  // --- Menus and popovers, which are not dialogs ---
  // The mobile navigation menu; its backdrop close is asserted by
  // TopNavigation.test.tsx.
  'components/layout/TopNavigation.tsx',
  // The date-range preset popover.
  'components/ux/DateRangePicker.tsx',
  // The position dropdown on the elections screen.
  'pages/ElectionsPage.tsx',
]);

/** `closeOnClickOutside` passed to the shared Modal as anything but a literal false. */
const MODAL_OPT_IN = /closeOnClickOutside(?!=\{false\})/;

/**
 * A scrim or full-viewport container carrying a click handler. Matched on the
 * handler rather than the `modal-overlay` class, because two of the offenders
 * this was written for (`FieldEditor`, `ResetProgressButton`) scrim with a bare
 * `absolute inset-0 bg-black/60` instead.
 */
const SCRIM_WITH_HANDLER =
  /className=\{?[`"'][^`"']*(?:modal-overlay|(?:fixed|absolute) inset-0)[^`"']*[`"'][^>]*?\sonClick=/s;

/** The container-level `if (event.target === event.currentTarget) close()` shape. */
const TARGET_IS_CURRENT_TARGET = /\.target === \w+\.currentTarget/;

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

const files = collectSourceFiles(SRC);

interface Offender {
  file: string;
  line: number;
  why: string;
}

const findOffenders = (): Offender[] => {
  const offenders: Offender[] = [];

  for (const file of files) {
    const relative = path.relative(SRC, file);
    // The shell itself declares and reads the prop.
    if (relative === 'components/Modal.tsx') continue;
    if (ALLOWED.has(relative)) continue;

    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      if (MODAL_OPT_IN.test(line)) {
        offenders.push({ file: relative, line: index + 1, why: 're-enables closeOnClickOutside' });
      }
      if (TARGET_IS_CURRENT_TARGET.test(line)) {
        offenders.push({ file: relative, line: index + 1, why: 'closes on a backdrop click' });
      }
    });

    // A scrim's attributes routinely span several lines, so this one is matched
    // against the whole file and reported at the opening tag.
    SCRIM_WITH_HANDLER.lastIndex = 0;
    const scrim = SCRIM_WITH_HANDLER.exec(source);
    if (scrim) {
      offenders.push({
        file: relative,
        line: source.slice(0, scrim.index).split('\n').length,
        why: 'scrim carries a click handler',
      });
    }
  }

  return offenders;
};

describe('dialog dismissal integrity', () => {
  it('scans the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('leaves no dialog dismissable by a click outside it', () => {
    const report = findOffenders().map((o) => `${o.file}:${o.line} — ${o.why}`);

    expect(
      report,
      'A click in the gutter around a dialog must not close it: nothing is drafted, and ' +
        'callers reset their form state in onClose, so a slip discards the work with no undo. ' +
        'Remove the handler and leave Escape and the close button as the ways out. If the ' +
        'surface genuinely holds no user input (a palette, a picker), add it to ALLOWED in ' +
        'this file with a comment saying why.'
    ).toEqual([]);
  });
});
